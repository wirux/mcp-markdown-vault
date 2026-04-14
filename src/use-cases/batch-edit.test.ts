import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { MarkdownFileRepository } from "../infrastructure/markdown-file-repository.js";
import { UnifiedDiffService } from "../infrastructure/diff-service.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { BatchEditService, type EditOperation } from "./batch-edit.js";
import { BatchLimitExceededError } from "../domain/errors/index.js";

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
  it("zwraca puste wyniki dla pustej tablicy operacji", async () => {
    const result = await service.execute({ operations: [] });

    expect(result.totalRequested).toBe(0);
    expect(result.totalSucceeded).toBe(0);
    expect(result.totalFailed).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.stoppedAtIndex).toBeUndefined();
  });

  it("wykonuje wszystkie operacje pomyślnie", async () => {
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

    // Sprawdź pliki na dysku
    const content1 = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");
    expect(content1).toContain("Appended 1.");
    const content2 = await fs.readFile(path.join(tmpDir, "note2.md"), "utf-8");
    expect(content2).toContain("Appended 2.");
  });

  it("zatrzymuje się na pierwszym błędzie i zwraca częściowe wyniki", async () => {
    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "OK." },
      { path: "nonexistent.md", operation: "append", content: "Fail." },
      { path: "note2.md", operation: "append", content: "Nigdy." },
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

    // Trzecia operacja nie powinna być próbowana
    const content2 = await fs.readFile(path.join(tmpDir, "note2.md"), "utf-8");
    expect(content2).not.toContain("Nigdy.");
  });

  it("dryRun generuje diffy bez zapisu na dysk", async () => {
    const original = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");

    const operations: EditOperation[] = [
      { path: "note1.md", operation: "append", content: "DryRun content." },
    ];

    const result = await service.execute({ operations, dryRun: true });

    expect(result.totalSucceeded).toBe(1);
    expect(result.results[0]!.status).toBe("success");
    expect(result.results[0]!.diff).toBeDefined();
    expect(result.results[0]!.diff).toContain("DryRun content.");

    // Plik nie powinien się zmienić
    const afterContent = await fs.readFile(path.join(tmpDir, "note1.md"), "utf-8");
    expect(afterContent).toBe(original);
  });

  it("obsługuje mieszane typy operacji", async () => {
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

  it("łapie naruszenie SafePath", async () => {
    const operations: EditOperation[] = [
      { path: "../../etc/passwd", operation: "append", content: "Hack." },
    ];

    const result = await service.execute({ operations });

    expect(result.totalFailed).toBe(1);
    expect(result.results[0]!.status).toBe("error");
    expect(result.results[0]!.error).toBeDefined();
  });

  it("odrzuca operacje przekraczające limit", async () => {
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
