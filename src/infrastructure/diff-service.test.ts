import { describe, it, expect } from "vitest";
import { UnifiedDiffService } from "./diff-service.js";

describe("UnifiedDiffService", () => {
  const service = new UnifiedDiffService();

  it("produces a unified diff with added and removed lines", () => {
    const oldText = "line1\nline2\nline3\n";
    const newText = "line1\nchanged\nline3\n";

    const diff = service.generateDiff(oldText, newText, "test.md");

    expect(diff).toContain("-line2");
    expect(diff).toContain("+changed");
    expect(diff).toContain("test.md");
  });

  it("returns an empty-ish diff when content is identical", () => {
    const text = "same\n";
    const diff = service.generateDiff(text, text);

    // No +/- content lines expected
    expect(diff).not.toContain("+same");
    expect(diff).not.toContain("-same");
  });

  it("handles additions to an empty file", () => {
    const diff = service.generateDiff("", "# New\n\nContent.\n", "new.md");

    expect(diff).toContain("+# New");
    expect(diff).toContain("+Content.");
  });
});
