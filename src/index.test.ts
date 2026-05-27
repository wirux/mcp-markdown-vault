import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LocalFileSystemAdapter } from "./infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "./infrastructure/vector-store/in-memory-vector-store.js";
import { createMcpServer } from "./presentation/mcp-tools.js";
import {
  DEFAULT_VAULT_SCOPE,
  createServerFactory,
  initializeVaultOrientation,
  makeVaultScopeProvider,
} from "./index.js";
import type {
  IEmbeddingProvider,
  IFileSystemAdapter,
  IVectorStore,
  VectorEntry,
  VectorSearchResult,
} from "./domain/interfaces/index.js";

class FakeEmbedder implements IEmbeddingProvider {
  readonly dimensions = 3;
  readonly modelName = "fake";

  async embed(text: string): Promise<number[]> {
    const size = text.length || 1;
    return [size, size / 2, size / 3];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

class ThrowingVectorStore implements IVectorStore {
  async upsert(_entry: VectorEntry): Promise<void> {
    throw new Error("unused in test");
  }

  async search(_queryVector: number[], _k: number): Promise<VectorSearchResult[]> {
    throw new Error("unused in test");
  }

  async delete(_docPath: string): Promise<void> {
    throw new Error("unused in test");
  }

  async has(_docPath: string): Promise<boolean> {
    throw new Error("unused in test");
  }

  async size(): Promise<number> {
    return 0;
  }

  async save(): Promise<void> {}
}

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempVault() {
  const tmpPath = await mkdtemp(join(tmpdir(), "index-test-"));
  const vaultPath = await realpath(tmpPath);
  tmpDirs.push(vaultPath);
  const fsAdapter = await LocalFileSystemAdapter.create(vaultPath);
  return { vaultPath, fsAdapter };
}

async function readInitializeInstructions(server: ReturnType<typeof createMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "index-test-client", version: "1.0.0" });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client.getInstructions();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("src/index composition root helpers", () => {
  it("auto-init on empty vault creates both meta files", async () => {
    const { fsAdapter } = await makeTempVault();

    const result = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });

    expect(result.initResult.contractCreated).toBe(true);
    expect(result.initResult.overviewCreated).toBe(true);
    expect(await fsAdapter.exists("meta/contract.md")).toBe(true);
    expect(await fsAdapter.exists("meta/overview.md")).toBe(true);
  });

  it("auto-init when meta files exist does not overwrite and does not fail", async () => {
    const { fsAdapter } = await makeTempVault();
    await fsAdapter.writeNote("meta/contract.md", "# Custom Contract");
    await fsAdapter.writeNote("meta/overview.md", "# Custom Overview");

    const result = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });

    expect(result.initResult.contractCreated).toBe(false);
    expect(result.initResult.overviewCreated).toBe(false);
    expect(await fsAdapter.readNote("meta/contract.md")).toBe("# Custom Contract");
    expect(await fsAdapter.readNote("meta/overview.md")).toBe("# Custom Overview");
  });

  it("auto-init failure still returns scope provider and starts composition flow", async () => {
    const { fsAdapter } = await makeTempVault();
    const errors: unknown[][] = [];
    const brokenFsAdapter: IFileSystemAdapter = {
      listNotes: fsAdapter.listNotes.bind(fsAdapter),
      readNote: fsAdapter.readNote.bind(fsAdapter),
      exists: async () => false,
      writeNote: async () => {
        throw new Error("EROFS: read-only file system");
      },
      deleteNote: fsAdapter.deleteNote.bind(fsAdapter),
      stat: fsAdapter.stat.bind(fsAdapter),
    };

    const result = await initializeVaultOrientation({
      fsAdapter: brokenFsAdapter,
      mode: "manual",
      logger: {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
    });

    expect(typeof result.getVaultScope()).toBe("string");
    expect(result.scopeProvider.getScope()).toBe(result.getVaultScope());
    expect(errors).toEqual([]);
  });

  it("passes non-empty instructions to MCP server dependencies", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });
    const { factory: serverFactory } = createServerFactory({
      fsAdapter,
      vectorStore: new InMemoryVectorStore(),
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      getVaultScope: orientation.getVaultScope,
    });

    const instructions = await readInitializeInstructions(serverFactory());

    expect(instructions).toBeDefined();
    expect(instructions!.length).toBeGreaterThan(0);
    expect(instructions).toContain("Vault scope:");
  });

  it("getVaultScope returns default when overview.md does not exist", async () => {
    const { fsAdapter } = await makeTempVault();
    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(provider.getScope()).toBe(DEFAULT_VAULT_SCOPE);
  });

  it("createServerFactory injects workflow per server instance while preserving orientation data", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });
    const vectorStore = new ThrowingVectorStore();
    const { factory: serverFactory } = createServerFactory({
      fsAdapter,
      vectorStore,
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      getVaultScope: orientation.getVaultScope,
    });

    const serverA = serverFactory();
    const serverB = serverFactory();

    expect(serverA).not.toBe(serverB);
  });
});

describe("parseVaultContextConfig integration", () => {
  beforeEach(() => {
    delete process.env["VAULT_CONTEXT"];
    delete process.env["VAULT_CONTEXT_MODE"];
  });

  afterEach(() => {
    delete process.env["VAULT_CONTEXT"];
    delete process.env["VAULT_CONTEXT_MODE"];
  });

  it("defaults to assisted mode when VAULT_CONTEXT_MODE is unset", async () => {
    const { parseVaultContextConfig } = await import("./use-cases/vault-context-config.js");
    const config = parseVaultContextConfig({});
    expect(config.mode).toBe("assisted");
  });

  it("accepts manual mode", async () => {
    const { parseVaultContextConfig } = await import("./use-cases/vault-context-config.js");
    const config = parseVaultContextConfig({ VAULT_CONTEXT_MODE: "manual" });
    expect(config.mode).toBe("manual");
  });

  it("throws InvalidConfigError for invalid mode", async () => {
    const { parseVaultContextConfig } = await import("./use-cases/vault-context-config.js");
    expect(() => parseVaultContextConfig({ VAULT_CONTEXT_MODE: "bogus" })).toThrow();
  });

  it("detects deprecated VAULT_CONTEXT", async () => {
    const { parseVaultContextConfig } = await import("./use-cases/vault-context-config.js");
    const config = parseVaultContextConfig({ VAULT_CONTEXT: "old value" });
    expect(config.deprecatedVaultContext).toBe("old value");
  });
});

describe("vault scope from frontmatter integration", () => {
  it("makeVaultScopeProvider reads vault_scope from frontmatter", async () => {
    const { fsAdapter } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nschema_version: 1\nvault_scope: "my custom vault scope"\n---\n\n# Overview\n`,
    );

    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(provider.getScope()).toBe("my custom vault scope");
  });

  it("makeVaultScopeProvider falls back to DEFAULT_VAULT_SCOPE when vault_scope missing", async () => {
    const { fsAdapter } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nschema_version: 1\nmanaged_by: auto\n---\n\n# Overview\n`,
    );

    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(provider.getScope()).toBe(DEFAULT_VAULT_SCOPE);
  });

  it("makeVaultScopeProvider.refresh() picks up new vault_scope after overview rewrite", async () => {
    const { fsAdapter } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nvault_scope: "original scope"\n---\n\n# Overview\n`,
    );

    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(provider.getScope()).toBe("original scope");

    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nvault_scope: "updated scope after refresh"\n---\n\n# Overview\n`,
      true,
    );
    provider.refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(provider.getScope()).toBe("updated scope after refresh");
  });

  it("createServerFactory uses real vault scope in instructions on each server creation", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nvault_scope: "dynamic scope value"\n---\n\n# Overview\n`,
    );

    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const { factory: serverFactory } = createServerFactory({
      fsAdapter,
      vectorStore: new InMemoryVectorStore(),
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      getVaultScope: provider.getScope,
    });

    const instructions = await readInitializeInstructions(serverFactory());
    expect(instructions).toContain("dynamic scope value");
  });

  it("after scope refresh, new server sees updated instructions", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nvault_scope: "scope v1"\n---\n\n# Overview\n`,
    );

    const provider = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const { factory: serverFactory } = createServerFactory({
      fsAdapter,
      vectorStore: new InMemoryVectorStore(),
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      getVaultScope: provider.getScope,
    });

    const instructions1 = await readInitializeInstructions(serverFactory());
    expect(instructions1).toContain("scope v1");

    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nvault_scope: "scope v2"\n---\n\n# Overview\n`,
      true,
    );
    provider.refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const instructions2 = await readInitializeInstructions(serverFactory());
    expect(instructions2).toContain("scope v2");
    expect(instructions2).not.toContain("scope v1");
  });

  it("manual mode: user-authored overview with vault_scope is respected", async () => {
    const { fsAdapter } = await makeTempVault();
    await fsAdapter.writeNote(
      "meta/overview.md",
      `---\nschema_version: 1\nmanaged_by: user\nvault_scope: "user-written scope"\n---\n\n# My Vault\n`,
    );

    const orientation = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(orientation.getVaultScope()).toBe("user-written scope");
  });
});
