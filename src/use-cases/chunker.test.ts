import { describe, it, expect } from "vitest";
import { MarkdownChunker } from "./chunker.js";

const chunker = new MarkdownChunker();

describe("MarkdownChunker", () => {
  describe("basic chunking", () => {
    it("produces a single chunk for a flat document", () => {
      const md = "Just a paragraph.\n\nAnother one.\n";
      const chunks = chunker.chunk(md);
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.headingPath).toEqual([]);
      expect(chunks[0]!.text).toContain("Just a paragraph.");
      expect(chunks[0]!.text).toContain("Another one.");
    });

    it("splits on H1 headings", () => {
      const md = "# Intro\n\nFirst.\n\n# Methods\n\nSecond.\n";
      const chunks = chunker.chunk(md);
      expect(chunks.length).toBe(2);
      expect(chunks[0]!.headingPath).toEqual(["Intro"]);
      expect(chunks[0]!.text).toContain("First.");
      expect(chunks[1]!.headingPath).toEqual(["Methods"]);
      expect(chunks[1]!.text).toContain("Second.");
    });

    it("splits on H2 headings and nests under parent H1", () => {
      const md =
        "# Title\n\nIntro.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n";
      const chunks = chunker.chunk(md);
      // Expect: Title preamble, Section A, Section B
      expect(chunks.length).toBe(3);
      expect(chunks[0]!.headingPath).toEqual(["Title"]);
      expect(chunks[1]!.headingPath).toEqual(["Title", "Section A"]);
      expect(chunks[2]!.headingPath).toEqual(["Title", "Section B"]);
    });
  });

  describe("heading path hierarchy", () => {
    it("builds nested heading paths (H1 > H2 > H3)", () => {
      const md =
        "# Root\n\n## Parent\n\n### Child\n\nDeep content.\n";
      const chunks = chunker.chunk(md);
      const deepChunk = chunks.find((c) =>
        c.headingPath.includes("Child"),
      );
      expect(deepChunk).toBeDefined();
      expect(deepChunk!.headingPath).toEqual(["Root", "Parent", "Child"]);
    });

    it("resets heading path when a higher-level heading appears", () => {
      const md =
        "# A\n\n## A.1\n\n### A.1.1\n\nDeep.\n\n# B\n\n## B.1\n\nOther.\n";
      const chunks = chunker.chunk(md);
      const b1 = chunks.find((c) => c.headingPath.includes("B.1"));
      expect(b1).toBeDefined();
      expect(b1!.headingPath).toEqual(["B", "B.1"]);
    });
  });

  describe("frontmatter handling", () => {
    it("excludes YAML frontmatter from chunk text", () => {
      const md = "---\ntitle: Test\ntags: [a]\n---\n\n# Heading\n\nBody.\n";
      const chunks = chunker.chunk(md);
      for (const chunk of chunks) {
        expect(chunk.text).not.toContain("---");
        expect(chunk.text).not.toContain("title:");
      }
    });
  });

  describe("chunk metadata", () => {
    it("includes start and end line numbers", () => {
      const md = "# A\n\nParagraph.\n\n# B\n\nMore text.\n";
      const chunks = chunker.chunk(md);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBeGreaterThan(1);
      expect(chunks[1]!.startLine).toBeGreaterThan(chunks[0]!.endLine);
    });

    it("includes word count (heading words + body words)", () => {
      const md = "# Title\n\nOne two three four five.\n";
      const chunks = chunker.chunk(md);
      // "Title" (from heading) + 5 body words = 6
      expect(chunks[0]!.wordCount).toBe(6);
    });
  });

  describe("empty / edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(chunker.chunk("")).toEqual([]);
    });

    it("returns empty array for whitespace-only", () => {
      expect(chunker.chunk("   \n\n  \n")).toEqual([]);
    });

    it("handles document with only frontmatter", () => {
      const md = "---\ntitle: Empty\n---\n";
      const chunks = chunker.chunk(md);
      expect(chunks).toEqual([]);
    });
  });
});
