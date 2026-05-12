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
  DEFAULT_VAULT_CONTEXT,
  createServerFactory,
  initializeVaultOrientation,
  readVaultContext,
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
const originalVaultContext = process.env["VAULT_CONTEXT"];

beforeEach(() => {
  delete process.env["VAULT_CONTEXT"];
});

afterEach(async () => {
  if (originalVaultContext === undefined) {
    delete process.env["VAULT_CONTEXT"];
  } else {
    process.env["VAULT_CONTEXT"] = originalVaultContext;
  }

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
  it("uses default vault context when VAULT_CONTEXT is unset", () => {
    delete process.env["VAULT_CONTEXT"];
    expect(readVaultContext()).toBe(DEFAULT_VAULT_CONTEXT);
  });

  it("uses default vault context when VAULT_CONTEXT is empty string", () => {
    process.env["VAULT_CONTEXT"] = "";
    expect(readVaultContext()).toBe(DEFAULT_VAULT_CONTEXT);
  });

  it("uses provided VAULT_CONTEXT when set", () => {
    process.env["VAULT_CONTEXT"] = "my research vault";
    expect(readVaultContext()).toBe("my research vault");
  });

  it("auto-init on empty vault creates both meta files", async () => {
    const { fsAdapter } = await makeTempVault();

    const result = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: readVaultContext({ VAULT_CONTEXT: "my research vault" }),
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
      vaultContext: "my research vault",
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
      vaultContext: "my research vault",
      logger: {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
    });

    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.vaultScope).toBe("my research vault");
    expect(errors).toEqual([]);
  });

  it("passes non-empty instructions to MCP server dependencies", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: "my research vault",
      logger: { error: () => undefined },
    });
    const serverFactory = createServerFactory({
      fsAdapter,
      vectorStore: new InMemoryVectorStore(),
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      instructions: orientation.instructions,
      vaultScope: orientation.vaultScope,
    });

    const instructions = await readInitializeInstructions(serverFactory());

    expect(orientation.instructions.length).toBeGreaterThan(0);
    expect(instructions).toBe(orientation.instructions);
  });

  it("vaultScope uses vaultContext directly without file I/O", async () => {
    const { fsAdapter } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: "my research vault",
      logger: { error: () => undefined },
    });
    expect(orientation.vaultScope).toBe("my research vault");
  });

  it("vaultScope falls back to default when vaultContext is empty", async () => {
    const { fsAdapter } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: "",
      logger: { error: () => undefined },
    });
    expect(orientation.vaultScope).toBe(DEFAULT_VAULT_CONTEXT);
  });

  it("vaultScope falls back to default when vaultContext is whitespace", async () => {
    const { fsAdapter } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: "   ",
      logger: { error: () => undefined },
    });
    expect(orientation.vaultScope).toBe(DEFAULT_VAULT_CONTEXT);
  });

  it("createServerFactory injects workflow per server instance while preserving orientation data", async () => {
    const { fsAdapter, vaultPath } = await makeTempVault();
    const orientation = await initializeVaultOrientation({
      fsAdapter,
      vaultContext: "factory vault",
      logger: { error: () => undefined },
    });
    const vectorStore = new ThrowingVectorStore();
    const serverFactory = createServerFactory({
      fsAdapter,
      vectorStore,
      embedder: new FakeEmbedder(),
      vaultRoot: vaultPath,
      instructions: orientation.instructions,
      vaultScope: orientation.vaultScope,
    });

    const serverA = serverFactory();
    const serverB = serverFactory();

    expect(serverA).not.toBe(serverB);
  });
});
