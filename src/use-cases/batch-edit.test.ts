import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { MarkdownFileRepository } from "../infrastructure/markdown-file-repository.js";
import { UnifiedDiffService } from "../infrastructure/diff-service.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { BatchEditService, type EditOperation } from "./batch-edit.js";
import { BatchLimitExceededError, AmbiguousHeadingTargetError } from "../domain/errors/index.js";

let tmpDir: string;
let service: BatchEditService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "batch-edit-test-"));

  await fs.writeFile(
    path.join(tmpDir, "note1.md"),
    "# Note 1\n\n## Section A\n\nContent A.\n",
  );
  await fs.writeFile(
    path.join(tmpDir, "note2.md"),
    "# Note 2\n\nSome text here.\n",
  );

  const fsAdapter = await LocalFileSystemAdapter.create(tmpDir);
  const pipeline = new MarkdownPipeline();
  const diffService = new UnifiedDiffService();
  const repo = new MarkdownFileRepository(fsAdapter, pipeline);
  service = new BatchEditService(fsAdapter, pipeline, diffService, repo);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("BatchEditService", () => {
  it("returns empty results for an empty operations array", async () => {
    const result = await service.execute({ operations: [] });

    expect(result.totalRequested).toBe(0);
    expect(result.totalSucceeded).toBe(0);
    expect(result.totalFailed).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.stoppedAtIndex).toBeUndefined();
  });

  it("executes all operations successfully", async () => {
    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "Appended 1.", heading: "Section A", headingDepth: 2 },
      { path: "note2.md", operation: "append", content: "Appended 2." },
    ];

    const result = await service.execute({ operations });

    expect(result.totalRequested).toBe(2);
    expect(result.totalSucceeded).toBe(2);
    expect(result.totalFailed).toBe(0);
    expect(result.stoppedAtIndex).toBeUndefined();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[1]!.status).toBe("success");

    // Verify files on disk
    const content1 = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");
    expect(content1).toContain("Appended 1.");
    const content2 = await fs.readFile(path.join(tmpDir, "note2.md"), "utf-8");
    expect(content2).toContain("Appended 2.");
  });

  it("stops on first error and returns partial results", async () => {
    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "OK." },
      { path: "nonexistent.md", operation: "append", content: "Fail." },
      { path: "note2.md", operation: "append", content: "Never." },
    ];

    const result = await service.execute({ operations });

    expect(result.totalRequested).toBe(3);
    expect(result.totalSucceeded).toBe(1);
    expect(result.totalFailed).toBe(1);
    expect(result.stoppedAtIndex).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[1]!.status).toBe("error");
    expect(result.results[1]!.error).toBeDefined();

    // Third operation should not have been attempted
    const content2 = await fs.readFile(path.join(tmpDir, "note2.md"), "utf-8");
    expect(content2).not.toContain("Never.");
  });

  it("dryRun generates diffs without writing to disk", async () => {
    const original = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");

    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "DryRun content." },
    ];

    const result = await service.execute({ operations, dryRun: true });

    expect(result.totalSucceeded).toBe(1);
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.diff).toBeDefined();
    expect(result.results[0]!.diff).toContain("DryRun content.");

    // File should not have changed
    const afterContent = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");
    expect(afterContent).toBe(original);
  });

  it("dryRun does not write for frontmatter_set", async () => {
    await fs.writeFile(
      path.join(tmpDir, "note3.md"),
      "---\ntags:\n  - gamma\n---\n\n# Note 3\n\nBody.\n",
    );
    const original = await fs.readFile(path.join(tmpDir, "note3.md"), "utf-8");

    const operations: EditOperation[] = [
      { path: "note3.md", operation: "frontmatter_set", content: '{"status":"draft"}' },
    ];

    const result = await service.execute({ operations, dryRun: true });

    expect(result.totalSucceeded).toBe(1);
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.diff).toBeDefined();
    expect(result.results[0]!.diff).toContain("status: draft");

    const afterContent = await fs.readFile(path.join(tmpDir, "note3.md"), "utf-8");
    expect(afterContent).toBe(original);
  });

  it("handles mixed operation types", async () => {
    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "Added.", heading: "Section A", headingDepth: 2 },
      { path: "note2.md", operation: "string_replace", content: "Replaced text.", searchText: "Some text here." },
    ];

    const result = await service.execute({ operations });

    expect(result.totalSucceeded).toBe(2);
    expect(result.results).toHaveLength(2);

    const content1 = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");
    expect(content1).toContain("Added.");

    const content2 = await fs.readFile(path.join(tmpDir, "note2.md"), "utf-8");
    expect(content2).toContain("Replaced text.");
    expect(content2).not.toContain("Some text here.");
  });

  it("catches SafePath violation", async () => {
    const operations: EditOperation[] = [
      { path: "../../etc/passwd", operation: "append", content: "Hack." },
    ];

    const result = await service.execute({ operations });

    expect(result.totalFailed).toBe(1);
    expect(result.results[0]!.status).toBe("error");
    expect(result.results[0]!.error).toBeDefined();
  });

  it("rejects operations exceeding the limit", async () => {
    const operations: EditOperation[] = Array.from({ length: 51 }, (_, i) => ({
      path: "note1.md",
      operation: "append" as const,
      content: `Op ${i}.`,
    }));

    await expect(
      service.execute({ operations }),
    ).rejects.toThrow(BatchLimitExceededError);
  });
});

describe("BatchEditService — duplicate heading detection", () => {
  let dupFile: string;

  beforeEach(async () => {
    dupFile = path.join(tmpDir, "dup.md");
    await fs.writeFile(
      dupFile,
      "# Title\n\n## Setup\n\nFirst setup.\n\n## Setup\n\nSecond setup.\n\n## Different\n\nOther.\n",
    );
  });

  it("throws AmbiguousHeadingTargetError when two headings match exactly", async () => {
    const result = await service.execute({
      operations: [{ path: "dup.md", operation: "replace", heading: "Setup", headingDepth: 2, content: "New." }],
    });
    expect(result.results[0]!.status).toBe("error");
    expect(result.results[0]!.error).toContain("Ambiguous heading target");
  });

  it("includes blockId guidance in ambiguous heading error", async () => {
    const result = await service.execute({
      operations: [{ path: "dup.md", operation: "replace", heading: "Setup", headingDepth: 2, content: "New." }],
    });
    expect(result.results[0]!.error).toContain("blockId");
  });

  it("succeeds when heading is unique (no ambiguity)", async () => {
    const result = await service.execute({
      operations: [{ path: "dup.md", operation: "append", heading: "Different", headingDepth: 2, content: "Appended." }],
    });
    expect(result.results[0]!.status).toBe("success");
  });

  it("fuzzy single match still resolves when no duplicate exists", async () => {
    const result = await service.execute({
      operations: [{ path: "dup.md", operation: "append", heading: "Diferent", headingDepth: 2, content: "Appended." }],
    });
    expect(result.results[0]!.status).toBe("success");
  });
});

describe("BatchEditService — delete operation", () => {
  let deleteFile: string;

  beforeEach(async () => {
    deleteFile = path.join(tmpDir, "delete.md");
    await fs.writeFile(
      deleteFile,
      "# Title\n\n## Keep\n\nKeep body.\n\n## Remove\n\nRemove body.\n\n### Child\n\nChild body.\n\n## Keep Too\n\nKeep too body.\n",
    );
  });

  it("deletes heading section including child headings", async () => {
    const result = await service.execute({
      operations: [{ path: "delete.md", operation: "delete", heading: "Remove", headingDepth: 2, content: "" }],
    });
    expect(result.results[0]!.status).toBe("success");
    const content = await fs.readFile(deleteFile, "utf8");
    expect(content).toContain("## Keep");
    expect(content).not.toContain("## Remove");
    expect(content).not.toContain("### Child");
    expect(content).toContain("## Keep Too");
  });

  it("delete with dryRun does not write the file", async () => {
    const original = await fs.readFile(deleteFile, "utf8");
    const result = await service.execute({
      operations: [{ path: "delete.md", operation: "delete", heading: "Remove", headingDepth: 2, content: "" }],
      dryRun: true,
    });
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.diff).toBeDefined();
    const after = await fs.readFile(deleteFile, "utf8");
    expect(after).toBe(original);
  });

  it("delete fails with error when heading does not exist", async () => {
    const result = await service.execute({
      operations: [{ path: "delete.md", operation: "delete", heading: "Nonexistent", headingDepth: 2, content: "" }],
    });
    expect(result.results[0]!.status).toBe("error");
  });
});

describe("BatchEditService — changed field", () => {
  it("result has changed=true after successful replace that modifies content", async () => {
    const result = await service.execute({
      operations: [{ path: "note1.md", operation: "replace", heading: "Section A", headingDepth: 2, content: "New content." }],
    });
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.changed).toBe(true);
  });

  it("result has changed=true after append", async () => {
    const result = await service.execute({
      operations: [{ path: "note1.md", operation: "append", heading: "Section A", headingDepth: 2, content: "Extra line." }],
    });
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.changed).toBe(true);
  });
});
