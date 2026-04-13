import { describe, it, expect, vi } from "vitest";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IDiffService } from "../domain/interfaces/diff-service.js";
import { DryRunEditor } from "./dry-run-edit.js";

function mockFs(): IFileSystemAdapter {
  return {
    listNotes: vi.fn(),
    readNote: vi.fn(),
    writeNote: vi.fn().mockResolvedValue(undefined),
    deleteNote: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
  } as unknown as IFileSystemAdapter;
}

function mockDiffService(diffOutput: string): IDiffService {
  return {
    generateDiff: vi.fn().mockReturnValue(diffOutput),
  };
}

describe("DryRunEditor", () => {
  const OLD_CONTENT = "# Title\n\nOld paragraph.\n";
  const NEW_CONTENT = "# Title\n\nNew paragraph.\n";
  const FAKE_DIFF = "--- a/note.md\n+++ b/note.md\n@@ -1,3 +1,3 @@\n # Title\n \n-Old paragraph.\n+New paragraph.\n";

  it("returns diff and does NOT write when dryRun=true", async () => {
    const fs = mockFs();
    const diff = mockDiffService(FAKE_DIFF);
    const editor = new DryRunEditor(fs, diff);

    const result = await editor.execute({
      path: "note.md",
      oldContent: OLD_CONTENT,
      newContent: NEW_CONTENT,
      dryRun: true,
      operationLabel: "append",
    });

    expect(fs.writeNote).not.toHaveBeenCalled();
    expect(result.diff).toBe(FAKE_DIFF);
    expect(diff.generateDiff).toHaveBeenCalledWith(
      OLD_CONTENT,
      NEW_CONTENT,
      "note.md",
    );
    expect(result.message).toContain("dry-run");
  });

  it("writes content and does NOT return diff when dryRun=false", async () => {
    const fs = mockFs();
    const diff = mockDiffService(FAKE_DIFF);
    const editor = new DryRunEditor(fs, diff);

    const result = await editor.execute({
      path: "note.md",
      oldContent: OLD_CONTENT,
      newContent: NEW_CONTENT,
      dryRun: false,
      operationLabel: "replace",
    });

    expect(fs.writeNote).toHaveBeenCalledWith("note.md", NEW_CONTENT, true);
    expect(diff.generateDiff).not.toHaveBeenCalled();
    expect(result.diff).toBeUndefined();
    expect(result.message).toContain("note.md");
    expect(result.message).toContain("replace");
  });
});
