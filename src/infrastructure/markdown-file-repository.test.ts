import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalFileSystemAdapter } from "./local-fs-adapter.js";
import { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";
import { MarkdownFileRepository } from "./markdown-file-repository.js";
import { NoteNotFoundError } from "../domain/errors/index.js";

let vaultDir: string;
let repo: MarkdownFileRepository;

const pipeline = new MarkdownPipeline();

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-repo-test-"));
  const adapter = await LocalFileSystemAdapter.create(vaultDir);
  repo = new MarkdownFileRepository(adapter, pipeline);
});

afterEach(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
});

describe("MarkdownFileRepository", () => {
  it("returns a parsed AST Root for an existing note", async () => {
    await fs.writeFile(
      path.join(vaultDir, "test.md"),
      "# Hello\n\nWorld.\n",
    );

    const tree = await repo.getAstByPath("test.md");

    expect(tree.type).toBe("root");
    expect(tree.children.length).toBeGreaterThan(0);
    expect(tree.children[0]!.type).toBe("heading");
  });

  it("throws NoteNotFoundError for a missing file", async () => {
    await expect(repo.getAstByPath("missing.md")).rejects.toThrow(
      NoteNotFoundError,
    );
  });
});
