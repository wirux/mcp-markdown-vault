import { describe, it, expect } from "vitest";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstNavigator } from "./ast-navigation.js";
import type { Heading } from "mdast";

const pipeline = new MarkdownPipeline();

const COMPLEX_DOC = `---
title: Complex Note
---

# Introduction

Some intro text.

## Section A

Content A paragraph 1.

Content A paragraph 2.

### Subsection A.1

Nested content.

## Section B

Content B here.

### Subsection B.1

More nested. ^block-id-1

## Section C

Final section.
`;

describe("AstNavigator", () => {
  describe("findHeading", () => {
    it("finds a heading by exact title and depth", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findHeading(tree, "Section A", 2);
      expect(result).not.toBeNull();
      expect(result!.node.type).toBe("heading");
      expect((result!.node as Heading).depth).toBe(2);
    });

    it("returns null for non-existent heading", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findHeading(tree, "Does Not Exist", 2);
      expect(result).toBeNull();
    });

    it("returns null when depth doesn't match", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findHeading(tree, "Section A", 3);
      expect(result).toBeNull();
    });

    it("matches case-insensitively", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findHeading(tree, "section a", 2);
      expect(result).not.toBeNull();
    });
  });

  describe("getHeadingRange", () => {
    it("returns all nodes under a heading until the next same-level heading", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const range = AstNavigator.getHeadingRange(tree, "Section A", 2);
      expect(range).not.toBeNull();
      // Should include: heading, paragraph x2, h3 subsection, nested paragraph
      expect(range!.startIndex).toBeGreaterThan(0);
      expect(range!.endIndex).toBeGreaterThan(range!.startIndex);

      // The content should include the subsection
      const slice = tree.children.slice(range!.startIndex, range!.endIndex);
      const headings = slice.filter((n) => n.type === "heading");
      expect(headings.length).toBe(2); // H2 Section A + H3 Subsection A.1
    });

    it("captures to end of document for the last heading", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const range = AstNavigator.getHeadingRange(tree, "Section C", 2);
      expect(range).not.toBeNull();
      expect(range!.endIndex).toBe(tree.children.length);
    });

    it("returns null for missing heading", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const range = AstNavigator.getHeadingRange(tree, "Nope", 2);
      expect(range).toBeNull();
    });
  });

  describe("findBlockById", () => {
    it("finds a paragraph ending with ^block-id", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findBlockById(tree, "block-id-1");
      expect(result).not.toBeNull();
      expect(result!.node.type).toBe("paragraph");
    });

    it("returns null for non-existent block ID", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const result = AstNavigator.findBlockById(tree, "no-such-id");
      expect(result).toBeNull();
    });
  });

  describe("getHeadingText", () => {
    it("extracts plain text from heading node", () => {
      const tree = pipeline.parse("## Hello **World**\n");
      const heading = tree.children[0] as Heading;
      expect(AstNavigator.getHeadingText(heading)).toBe("Hello World");
    });
  });

  describe("findAllHeadings", () => {
    it("returns all headings with their indices", () => {
      const tree = pipeline.parse(COMPLEX_DOC);
      const headings = AstNavigator.findAllHeadings(tree);
      expect(headings.length).toBe(6); // H1 + 3xH2 + 2xH3
      expect(headings[0]!.depth).toBe(1);
      expect(headings[0]!.title).toBe("Introduction");
    });
  });
});
