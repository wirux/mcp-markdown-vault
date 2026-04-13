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

// ── getAstByPath ──────────────────────────────────────────────────

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

// ── readFrontmatter ───────────────────────────────────────────────

describe("readFrontmatter", () => {
  it("returns parsed frontmatter object", async () => {
    await fs.writeFile(
      path.join(vaultDir, "fm.md"),
      "---\ntags:\n  - mcp\nstatus: draft\n---\n\n# Content\n",
    );

    const data = await repo.readFrontmatter("fm.md");

    expect(data).toEqual({ tags: ["mcp"], status: "draft" });
  });

  it("returns empty object when file has no frontmatter", async () => {
    await fs.writeFile(
      path.join(vaultDir, "no-fm.md"),
      "# Just a heading\n\nSome text.\n",
    );

    const data = await repo.readFrontmatter("no-fm.md");

    expect(data).toEqual({});
  });

  it("throws NoteNotFoundError for missing file", async () => {
    await expect(repo.readFrontmatter("nope.md")).rejects.toThrow(
      NoteNotFoundError,
    );
  });
});

// ── updateFrontmatter ─────────────────────────────────────────────

describe("updateFrontmatter", () => {
  it("merges new fields into existing frontmatter", async () => {
    await fs.writeFile(
      path.join(vaultDir, "update.md"),
      "---\ntags:\n  - mcp\nstatus: draft\n---\n\n# Content\n\nBody text.\n",
    );

    await repo.updateFrontmatter("update.md", { status: "published", priority: 1 });

    const result = await fs.readFile(path.join(vaultDir, "update.md"), "utf-8");
    const data = await repo.readFrontmatter("update.md");

    expect(data.tags).toEqual(["mcp"]);
    expect(data.status).toBe("published");
    expect(data.priority).toBe(1);
    // Body must be preserved exactly
    expect(result).toContain("# Content");
    expect(result).toContain("Body text.");
  });

  it("creates frontmatter when none exists", async () => {
    await fs.writeFile(
      path.join(vaultDir, "no-fm.md"),
      "# Heading\n\nParagraph.\n",
    );

    await repo.updateFrontmatter("no-fm.md", { status: "new" });

    const result = await fs.readFile(path.join(vaultDir, "no-fm.md"), "utf-8");
    const data = await repo.readFrontmatter("no-fm.md");

    expect(data.status).toBe("new");
    expect(result).toContain("# Heading");
    expect(result).toContain("Paragraph.");
  });

  it("preserves markdown body exactly after update", async () => {
    const body = "# Title\n\nParagraph with **bold** and _italic_.\n\n* item 1\n* item 2\n";
    await fs.writeFile(
      path.join(vaultDir, "preserve.md"),
      `---\nkey: value\n---\n\n${body}`,
    );

    await repo.updateFrontmatter("preserve.md", { key: "updated" });

    const result = await fs.readFile(path.join(vaultDir, "preserve.md"), "utf-8");
    expect(result).toContain("# Title");
    expect(result).toContain("Paragraph with **bold** and _italic_.");
    expect(result).toContain("* item 1");
    expect(result).toContain("* item 2");
  });
});
