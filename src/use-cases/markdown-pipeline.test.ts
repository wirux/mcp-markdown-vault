import { describe, it, expect } from "vitest";
import { MarkdownPipeline } from "./markdown-pipeline.js";

const pipeline = new MarkdownPipeline();

describe("MarkdownPipeline", () => {
  describe("parse → stringify round-trip", () => {
    it("preserves a simple document", () => {
      const md = "# Hello\n\nWorld\n";
      const tree = pipeline.parse(md);
      const out = pipeline.stringify(tree);
      expect(out).toBe(md);
    });

    it("preserves GFM tables", () => {
      const md = "| A | B |\n| - | - |\n| 1 | 2 |\n";
      const tree = pipeline.parse(md);
      const out = pipeline.stringify(tree);
      expect(out).toBe(md);
    });

    it("preserves YAML frontmatter", () => {
      const md = "---\ntitle: Test\ntags: [a, b]\n---\n\n# Content\n";
      const tree = pipeline.parse(md);
      const out = pipeline.stringify(tree);
      expect(out).toBe(md);
    });

    it("preserves task lists", () => {
      const md = "* [x] Done\n* [ ] Todo\n";
      const tree = pipeline.parse(md);
      const out = pipeline.stringify(tree);
      expect(out).toBe(md);
    });
  });

  describe("parse structure", () => {
    it("produces a root node with children", () => {
      const tree = pipeline.parse("# Title\n\nParagraph\n");
      expect(tree.type).toBe("root");
      expect(tree.children.length).toBeGreaterThan(0);
    });

    it("parses frontmatter as a yaml node", () => {
      const tree = pipeline.parse("---\nkey: val\n---\n\nBody\n");
      expect(tree.children[0]?.type).toBe("yaml");
    });
  });
});
