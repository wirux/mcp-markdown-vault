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

  it("auto-init failure still returns instructions and starts composition flow", async () => {
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

    expect(result.instructions.length).toBeGreaterThan(0);
    expect(typeof result.getVaultScope()).toBe("string");
    expect(errors).toEqual([]);
  });

  it("passes non-empty instructions to MCP server dependencies", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });
    const serverFactory = createServerFactory({
      fsAdapter,
      vectorStore: new InMemoryVectorStore(),
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      instructions: orientation.instructions,
      getVaultScope: orientation.getVaultScope,
    });

    const instructions = await readInitializeInstructions(serverFactory());

    expect(orientation.instructions.length).toBeGreaterThan(0);
    expect(instructions).toBe(orientation.instructions);
  });

  it("getVaultScope returns default when overview.md does not exist", async () => {
    const { fsAdapter } = await makeTempVault();
    const getVaultScope = makeVaultScopeProvider(fsAdapter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getVaultScope()).toBe(DEFAULT_VAULT_SCOPE);
  });

  it("createServerFactory injects workflow per server instance while preserving orientation data", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      mode: "manual",
      logger: { error: () => undefined },
    });
    const vectorStore = new ThrowingVectorStore();
    const serverFactory = createServerFactory({
      fsAdapter,
      vectorStore,
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      instructions: orientation.instructions,
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

  it("defaults to auto mode when VAULT_CONTEXT_MODE is unset", async () => {
    const { parseVaultContextConfig } = await import("./use-cases/vault-context-config.js");
    const config = parseVaultContextConfig({});
    expect(config.mode).toBe("auto");
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
