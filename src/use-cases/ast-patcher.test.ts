import { describe, it, expect } from "vitest";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstPatcher, type PatchOperation } from "./ast-patcher.js";
import { HeadingNotFoundError, BlockNotFoundError } from "../domain/errors/index.js";

const pipeline = new MarkdownPipeline();

function applyPatch(source: string, op: PatchOperation): string {
  const tree = pipeline.parse(source);
  AstPatcher.apply(tree, op, pipeline);
  return pipeline.stringify(tree);
}

// ── Heading-targeted operations ────────────────────────────────────

describe("AstPatcher — heading operations", () => {
  const DOC = `# Title

Intro paragraph.

## Section A

Content A.

### Subsection A.1

Nested content.

## Section B

Content B.
`;

  describe("append", () => {
    it("appends content at the end of a heading section", () => {
      const result = applyPatch(DOC, {
        type: "append",
        target: { heading: "Section A", depth: 2 },
        content: "Appended paragraph.",
      });
      // Appended text should appear before ## Section B
      const lines = result.split("\n");
      const sectionBIdx = lines.findIndex((l) => l === "## Section B");
      const appendedIdx = lines.findIndex((l) => l === "Appended paragraph.");
      expect(appendedIdx).toBeGreaterThan(0);
      expect(appendedIdx).toBeLessThan(sectionBIdx);
    });

    it("does NOT corrupt the subsequent H3 heading (PLAN.md critical test)", () => {
      const result = applyPatch(DOC, {
        type: "append",
        target: { heading: "Section A", depth: 2 },
        content: "New content after subsection.",
      });
      // H3 subsection must still be present
      expect(result).toContain("### Subsection A.1");
      // Content B must still be under Section B
      expect(result).toContain("## Section B");
      expect(result).toContain("Content B.");
      // The appended content should be present
      expect(result).toContain("New content after subsection.");
    });

    it("appends to the last section (extends to end of document)", () => {
      const result = applyPatch(DOC, {
        type: "append",
        target: { heading: "Section B", depth: 2 },
        content: "End of doc addition.",
      });
      expect(result.trimEnd().endsWith("End of doc addition.")).toBe(true);
    });
  });

  describe("prepend", () => {
    it("prepends content right after the heading line", () => {
      const result = applyPatch(DOC, {
        type: "prepend",
        target: { heading: "Section A", depth: 2 },
        content: "Prepended text.",
      });
      const lines = result.split("\n");
      const headingIdx = lines.findIndex((l) => l === "## Section A");
      // Next non-empty line after heading should be our prepended text
      const nextContentIdx = lines.findIndex(
        (l, i) => i > headingIdx && l.trim().length > 0,
      );
      expect(lines[nextContentIdx]).toBe("Prepended text.");
    });
  });

  describe("replace", () => {
    it("replaces the body of a heading section (keeping the heading itself)", () => {
      const result = applyPatch(DOC, {
        type: "replace",
        target: { heading: "Section A", depth: 2 },
        content: "Completely new content.",
      });
      expect(result).toContain("## Section A");
      expect(result).toContain("Completely new content.");
      // Original content and subsection should be gone
      expect(result).not.toContain("Content A.");
      expect(result).not.toContain("### Subsection A.1");
      // Section B should be untouched
      expect(result).toContain("## Section B");
      expect(result).toContain("Content B.");
    });
  });

  describe("error cases", () => {
    it("throws HeadingNotFoundError for missing heading", () => {
      const tree = pipeline.parse(DOC);
      expect(() =>
        AstPatcher.apply(tree, {
          type: "append",
          target: { heading: "Nonexistent", depth: 2 },
          content: "x",
        }, pipeline),
      ).toThrow(HeadingNotFoundError);
    });
  });
});

// ── Block-targeted operations ──────────────────────────────────────

describe("AstPatcher — block ID operations", () => {
  const DOC_WITH_BLOCKS = `# Notes

First paragraph.

Important content here. ^important

More text after.
`;

  describe("append", () => {
    it("appends content after the identified block", () => {
      const result = applyPatch(DOC_WITH_BLOCKS, {
        type: "append",
        target: { blockId: "important" },
        content: "Appended after block.",
      });
      const lines = result.split("\n");
      const blockIdx = lines.findIndex((l) => l.includes("^important"));
      const appendedIdx = lines.findIndex((l) =>
        l.includes("Appended after block."),
      );
      expect(appendedIdx).toBeGreaterThan(blockIdx);
    });
  });

  describe("replace", () => {
    it("replaces the block paragraph", () => {
      const result = applyPatch(DOC_WITH_BLOCKS, {
        type: "replace",
        target: { blockId: "important" },
        content: "Replaced content. ^important",
      });
      expect(result).not.toContain("Important content here.");
      expect(result).toContain("Replaced content. ^important");
      expect(result).toContain("More text after.");
    });
  });

  describe("error cases", () => {
    it("throws BlockNotFoundError for missing block ID", () => {
      const tree = pipeline.parse(DOC_WITH_BLOCKS);
      expect(() =>
        AstPatcher.apply(tree, {
          type: "append",
          target: { blockId: "no-such-block" },
          content: "x",
        }, pipeline),
      ).toThrow(BlockNotFoundError);
    });
  });
});

// ── Document-level operations ──────────────────────────────────────

describe("AstPatcher — document-level", () => {
  it("appends to end of document when no target specified", () => {
    const doc = "# Title\n\nBody.\n";
    const result = applyPatch(doc, {
      type: "append",
      target: "document",
      content: "Appended to doc.",
    });
    expect(result.trimEnd().endsWith("Appended to doc.")).toBe(true);
  });

  it("prepends after frontmatter when present", () => {
    const doc = "---\ntitle: Test\n---\n\n# Heading\n\nBody.\n";
    const result = applyPatch(doc, {
      type: "prepend",
      target: "document",
      content: "Prepended text.",
    });
    // Should appear after frontmatter but before heading
    const lines = result.split("\n");
    const fmEnd = lines.lastIndexOf("---");
    const prependedIdx = lines.findIndex((l) => l === "Prepended text.");
    const headingIdx = lines.findIndex((l) => l === "# Heading");
    expect(prependedIdx).toBeGreaterThan(fmEnd);
    expect(prependedIdx).toBeLessThan(headingIdx);
  });
});
