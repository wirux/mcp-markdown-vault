import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { PersistedFlatVectorStore } from "./persisted-flat-vector-store.js";
import { VectorEntry } from "../../domain/interfaces/index.js";

describe("PersistedFlatVectorStore", () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-vault-"));
  });

  afterEach(async () => {
    await fs.rm(tmpVault, { recursive: true, force: true });
  });

  it("upsert then save then new instance load -> search returns correct results", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [
        {
          chunkId: "c1",
          vector: [1, 0],
          text: "hello",
          headingPath: ["h1"],
        },
      ],
    });
    await store1.save();

    const store2 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store2.load();
    
    expect(await store2.size()).toBe(1);
    
    const results = await store2.search([1, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.docPath).toBe("file1.md");
    expect(results[0]?.chunkId).toBe("c1");
    expect(results[0]?.similarity).toBeCloseTo(1.0);
  });

  it("Fingerprint mismatch (different model name) -> store loads empty, no error thrown", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [1, 0], text: "hello", headingPath: [] }],
    });
    await store1.save();

    const store2 = new PersistedFlatVectorStore(tmpVault, "other-model", 2);
    await store2.load();
    expect(await store2.size()).toBe(0);
  });

  it("Missing index files -> store initialises empty, no error thrown", async () => {
    const store = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store.load();
    expect(await store.size()).toBe(0);
  });

  it("Corrupted vectors.bin (truncated file) -> store initialises empty, logs warning", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [1, 0], text: "hello", headingPath: [] }],
    });
    await store1.save();

    // Truncate vectors.bin
    const vectorsPath = path.join(tmpVault, ".markdown_vault_mcp", "vectors.bin");
    await fs.truncate(vectorsPath, 1);

    const store2 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store2.load();
    expect(await store2.size()).toBe(0);
  });

  it("delete(filePath) removes all chunks for that file; save + reload confirms deletion", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [1, 0], text: "hello", headingPath: [] }],
    });
    await store1.upsert({
      docPath: "file2.md",
      chunks: [{ chunkId: "c2", vector: [0, 1], text: "world", headingPath: [] }],
    });
    
    await store1.delete("file1.md");
    await store1.save();

    const store2 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store2.load();
    expect(await store2.size()).toBe(1);
    expect(await store2.has("file2.md")).toBe(true);
    expect(await store2.has("file1.md")).toBe(false);
  });

  it("upsert same chunk id twice -> last write wins (upsert semantics, no duplicates)", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [1, 0], text: "first", headingPath: [] }],
    });
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [0, 1], text: "second", headingPath: [] }],
    });
    
    expect(await store1.size()).toBe(1);
    const results = await store1.search([0, 1], 1);
    expect(results[0]?.text).toBe("second");
    expect(results[0]?.similarity).toBeCloseTo(1.0);
  });

  it("Atomic write: simulate crash mid-write (write .tmp then skip rename) -> original index survives intact on next load", async () => {
    const store1 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store1.upsert({
      docPath: "file1.md",
      chunks: [{ chunkId: "c1", vector: [1, 0], text: "hello", headingPath: [] }],
    });
    await store1.save();

    // simulate crash by creating dummy tmp files and not renaming
    const tmpIndex = path.join(tmpVault, ".markdown_vault_mcp", "index.json.tmp");
    const tmpVectors = path.join(tmpVault, ".markdown_vault_mcp", "vectors.bin.tmp");
    await fs.writeFile(tmpIndex, "corrupted");
    await fs.writeFile(tmpVectors, "corrupted");

    const store2 = new PersistedFlatVectorStore(tmpVault, "test-model", 2);
    await store2.load();
    expect(await store2.size()).toBe(1); // the original survived
  });
});
