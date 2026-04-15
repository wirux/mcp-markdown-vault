import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  validateOllama,
  validateVectorStore,
  StartupError,
} from "./startup-checks.js";

// ── Ollama ──────────────────────────────────────────────────────────

describe("validateOllama", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when Ollama is reachable and model is pulled (exact name)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "nomic-embed-text" }] }),
    });

    await expect(
      validateOllama("http://localhost:11434", "nomic-embed-text"),
    ).resolves.toBeUndefined();
  });

  it("passes when model name matches with tag suffix", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "nomic-embed-text:latest" }],
      }),
    });

    await expect(
      validateOllama("http://localhost:11434", "nomic-embed-text"),
    ).resolves.toBeUndefined();
  });

  it("throws StartupError when Ollama is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const err = await validateOllama(
      "http://localhost:11434",
      "nomic-embed-text",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/not reachable/);
    expect((err as StartupError).hint).toMatch(/ollama serve/);
  });

  it("throws StartupError when Ollama returns non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      validateOllama("http://localhost:11434", "nomic-embed-text"),
    ).rejects.toThrow(StartupError);
  });

  it("throws StartupError when model is not pulled, lists available models", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3:latest" }, { name: "phi3:latest" }],
      }),
    });

    const err = await validateOllama(
      "http://localhost:11434",
      "nomic-embed-text",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/not pulled/);
    expect((err as StartupError).hint).toMatch(/ollama pull nomic-embed-text/);
    expect((err as StartupError).hint).toMatch(/llama3:latest/);
  });

  it("throws when models list is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });

    const err = await validateOllama(
      "http://localhost:11434",
      "nomic-embed-text",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).hint).toMatch(/\(none\)/);
  });

  it("strips trailing slashes from URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "nomic-embed-text:latest" }],
      }),
    });

    await validateOllama("http://localhost:11434///", "nomic-embed-text");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.any(Object),
    );
  });
});

// ── Vector store: Qdrant ────────────────────────────────────────────

describe("validateVectorStore — Qdrant", () => {
  const mockFetch = vi.fn();
  const baseOpts = {
    qdrantUrl: "http://localhost:6333",
    qdrantCollection: "markdown_vault",
    vaultPath: "/tmp",
    expectedDimensions: 384,
    expectedModel: "all-MiniLM-L6-v2",
    allowReset: false,
  };

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when Qdrant is reachable and collection does not exist", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { collections: [] } }),
    });

    await expect(validateVectorStore(baseOpts)).resolves.toBeUndefined();
  });

  it("passes when collection exists with matching dimensions", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { collections: [{ name: "markdown_vault" }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            config: { params: { vectors: { size: 384 } } },
          },
        }),
      });

    await expect(validateVectorStore(baseOpts)).resolves.toBeUndefined();
  });

  it("throws StartupError when Qdrant is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const err = await validateVectorStore(baseOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/not reachable/);
  });

  it("throws on dimension mismatch when allowReset=false", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { collections: [{ name: "markdown_vault" }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            config: { params: { vectors: { size: 768 } } },
          },
        }),
      });

    const err = await validateVectorStore(baseOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/vector size 768/);
    expect((err as StartupError).hint).toMatch(/VECTOR_STORE_RESET=true/);
  });

  it("deletes collection on dimension mismatch when allowReset=true", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { collections: [{ name: "markdown_vault" }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            config: { params: { vectors: { size: 768 } } },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(
      validateVectorStore({ ...baseOpts, allowReset: true }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [deleteUrl, deleteOpts] = mockFetch.mock.calls[2]!;
    expect(deleteUrl).toBe(
      "http://localhost:6333/collections/markdown_vault",
    );
    expect(deleteOpts).toMatchObject({ method: "DELETE" });
  });

  it("throws when collection delete fails during reset", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { collections: [{ name: "markdown_vault" }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            config: { params: { vectors: { size: 768 } } },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      validateVectorStore({ ...baseOpts, allowReset: true }),
    ).rejects.toThrow(StartupError);
  });
});

// ── Vector store: local persisted ───────────────────────────────────

describe("validateVectorStore — local store", () => {
  let tmpVault: string;
  const baseOpts = {
    qdrantCollection: "markdown_vault",
    expectedDimensions: 384,
    expectedModel: "all-MiniLM-L6-v2",
    allowReset: false,
  };

  beforeEach(async () => {
    tmpVault = await fs.mkdtemp(
      path.join(os.tmpdir(), "mcp-test-startup-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpVault, { recursive: true, force: true });
  });

  function writeIndex(meta: Record<string, unknown>): Promise<void> {
    const storeDir = path.join(tmpVault, ".markdown_vault_mcp");
    return fs.mkdir(storeDir, { recursive: true }).then(() =>
      fs.writeFile(
        path.join(storeDir, "index.json"),
        JSON.stringify(meta),
      ),
    );
  }

  it("passes when no index files exist (fresh vault)", async () => {
    await expect(
      validateVectorStore({ ...baseOpts, vaultPath: tmpVault }),
    ).resolves.toBeUndefined();
  });

  it("passes when index fingerprint matches", async () => {
    await writeIndex({
      version: 1,
      embeddingModel: "all-MiniLM-L6-v2",
      dimensions: 384,
      savedAt: new Date().toISOString(),
      chunks: [],
    });

    await expect(
      validateVectorStore({ ...baseOpts, vaultPath: tmpVault }),
    ).resolves.toBeUndefined();
  });

  it("throws on dimension mismatch when allowReset=false", async () => {
    await writeIndex({
      version: 1,
      embeddingModel: "nomic-embed-text",
      dimensions: 768,
      chunks: [],
    });

    const err = await validateVectorStore({
      ...baseOpts,
      vaultPath: tmpVault,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/incompatible/);
    expect((err as StartupError).message).toMatch(/dimensions.*768.*384/);
    expect((err as StartupError).hint).toMatch(/VECTOR_STORE_RESET=true/);
  });

  it("throws on model mismatch even when dimensions match", async () => {
    await writeIndex({
      version: 1,
      embeddingModel: "other-model",
      dimensions: 384,
      chunks: [],
    });

    const err = await validateVectorStore({
      ...baseOpts,
      vaultPath: tmpVault,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as StartupError).message).toMatch(/model.*other-model/);
  });

  it("deletes index files on dimension mismatch when allowReset=true", async () => {
    const storeDir = path.join(tmpVault, ".markdown_vault_mcp");
    await writeIndex({
      version: 1,
      embeddingModel: "nomic-embed-text",
      dimensions: 768,
      chunks: [],
    });
    await fs.writeFile(path.join(storeDir, "vectors.bin"), Buffer.alloc(8));

    await expect(
      validateVectorStore({
        ...baseOpts,
        vaultPath: tmpVault,
        allowReset: true,
      }),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(path.join(storeDir, "index.json")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(storeDir, "vectors.bin")),
    ).rejects.toThrow();
  });

  it("deletes index files on model mismatch when allowReset=true", async () => {
    await writeIndex({
      version: 1,
      embeddingModel: "other-model",
      dimensions: 384,
      chunks: [],
    });

    await expect(
      validateVectorStore({
        ...baseOpts,
        vaultPath: tmpVault,
        allowReset: true,
      }),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(path.join(tmpVault, ".markdown_vault_mcp", "index.json")),
    ).rejects.toThrow();
  });

  it("handles corrupted index.json when allowReset=true", async () => {
    const storeDir = path.join(tmpVault, ".markdown_vault_mcp");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, "index.json"), "NOT JSON{{{");

    await expect(
      validateVectorStore({
        ...baseOpts,
        vaultPath: tmpVault,
        allowReset: true,
      }),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(path.join(storeDir, "index.json")),
    ).rejects.toThrow();
  });

  it("throws on corrupted index.json when allowReset=false", async () => {
    const storeDir = path.join(tmpVault, ".markdown_vault_mcp");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, "index.json"), "NOT JSON{{{");

    await expect(
      validateVectorStore({ ...baseOpts, vaultPath: tmpVault }),
    ).rejects.toThrow(StartupError);
  });

  it("also removes stale .tmp files during reset", async () => {
    const storeDir = path.join(tmpVault, ".markdown_vault_mcp");
    await writeIndex({
      version: 1,
      embeddingModel: "old",
      dimensions: 768,
      chunks: [],
    });
    await fs.writeFile(
      path.join(storeDir, "index.json.tmp"),
      "stale",
    );
    await fs.writeFile(
      path.join(storeDir, "vectors.bin.tmp"),
      "stale",
    );

    await validateVectorStore({
      ...baseOpts,
      vaultPath: tmpVault,
      allowReset: true,
    });

    await expect(
      fs.access(path.join(storeDir, "index.json.tmp")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(storeDir, "vectors.bin.tmp")),
    ).rejects.toThrow();
  });
});
