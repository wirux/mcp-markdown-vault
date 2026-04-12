import { describe, it, expect } from "vitest";
import { FreeformEditor } from "./freeform-editor.js";
import { DomainError } from "../domain/errors/index.js";

const SAMPLE = [
  "# My Note",
  "",
  "First paragraph.",
  "",
  "Second paragraph.",
  "With two lines.",
  "",
  "Third paragraph.",
].join("\n");

describe("FreeformEditor", () => {
  describe("lineReplace", () => {
    it("replaces a single line", () => {
      const result = FreeformEditor.lineReplace(SAMPLE, 3, 3, "Updated line.");
      const lines = result.split("\n");
      expect(lines[2]).toBe("Updated line.");
      // Other lines unchanged
      expect(lines[0]).toBe("# My Note");
      expect(lines[4]).toBe("Second paragraph.");
    });

    it("replaces a range of lines", () => {
      const result = FreeformEditor.lineReplace(
        SAMPLE,
        5,
        6,
        "Merged into one.",
      );
      const lines = result.split("\n");
      expect(lines[4]).toBe("Merged into one.");
      // Total line count should decrease by 1 (replaced 2 lines with 1)
      expect(lines.length).toBe(SAMPLE.split("\n").length - 1);
    });

    it("inserts multiple lines in place of one", () => {
      const result = FreeformEditor.lineReplace(
        SAMPLE,
        3,
        3,
        "Line A.\nLine B.\nLine C.",
      );
      const lines = result.split("\n");
      expect(lines[2]).toBe("Line A.");
      expect(lines[3]).toBe("Line B.");
      expect(lines[4]).toBe("Line C.");
      // Total line count should increase by 2
      expect(lines.length).toBe(SAMPLE.split("\n").length + 2);
    });

    it("throws for startLine < 1", () => {
      expect(() => FreeformEditor.lineReplace(SAMPLE, 0, 3, "x")).toThrow(
        DomainError,
      );
    });

    it("throws for endLine beyond file length", () => {
      const lineCount = SAMPLE.split("\n").length;
      expect(() =>
        FreeformEditor.lineReplace(SAMPLE, 1, lineCount + 1, "x"),
      ).toThrow(DomainError);
    });

    it("throws for startLine > endLine", () => {
      expect(() => FreeformEditor.lineReplace(SAMPLE, 5, 3, "x")).toThrow(
        DomainError,
      );
    });
  });

  describe("stringReplace", () => {
    it("replaces first occurrence by default", () => {
      const source = "foo bar foo baz";
      const result = FreeformEditor.stringReplace(source, "foo", "qux");
      expect(result).toBe("qux bar foo baz");
    });

    it("replaces all occurrences with replaceAll", () => {
      const source = "foo bar foo baz foo";
      const result = FreeformEditor.stringReplace(source, "foo", "qux", true);
      expect(result).toBe("qux bar qux baz qux");
    });

    it("throws when search string not found", () => {
      expect(() =>
        FreeformEditor.stringReplace(SAMPLE, "NONEXISTENT", "x"),
      ).toThrow(DomainError);
    });

    it("handles multi-line search strings", () => {
      const result = FreeformEditor.stringReplace(
        SAMPLE,
        "Second paragraph.\nWith two lines.",
        "Combined paragraph.",
      );
      expect(result).toContain("Combined paragraph.");
      expect(result).not.toContain("With two lines.");
    });

    it("preserves surrounding whitespace", () => {
      const source = "  hello world  ";
      const result = FreeformEditor.stringReplace(source, "hello", "goodbye");
      expect(result).toBe("  goodbye world  ");
    });

    it("handles special regex characters in search string", () => {
      const source = "value is $100.00 (USD)";
      const result = FreeformEditor.stringReplace(
        source,
        "$100.00 (USD)",
        "$200.00 (EUR)",
      );
      expect(result).toBe("value is $200.00 (EUR)");
    });
  });
});
