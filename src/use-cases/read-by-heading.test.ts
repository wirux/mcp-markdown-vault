import { describe, it, expect } from "vitest";
import type { Root } from "mdast";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { ReadByHeadingUseCase } from "./read-by-heading.js";

// ── Helper: mock repository that returns a pre-parsed AST ──────────

const pipeline = new MarkdownPipeline();

function mockRepo(markdown: string): IMarkdownRepository {
  const tree: Root = pipeline.parse(markdown);
  return {
    getAstByPath: async (_path: string) => tree,
  };
}

// ── Test fixtures ──────────────────────────────────────────────────

const DOC_WITH_TWO_SECTIONS = `\
# Title

Intro paragraph.

## Setup

Setup line 1.

Setup line 2.

## Usage

Usage content here.
`;

const DOC_HEADING_AT_END = `\
# Title

## First

First section content.

## Last

Last section content line 1.

Last section content line 2.
`;

const DOC_WITH_SUBHEADINGS = `\
# Main

Main intro.

## Sub1

Sub1 content.

## Sub2

Sub2 content.

# Another

Another section.
`;

// ── Tests ──────────────────────────────────────────────────────────

describe("ReadByHeadingUseCase", () => {
  it("returns content under a heading that exists", async () => {
    const useCase = new ReadByHeadingUseCase(
      mockRepo(DOC_WITH_TWO_SECTIONS),
      pipeline,
    );

    const result = await useCase.execute({
      path: "note.md",
      heading: "Setup",
      headingDepth: 2,
    });

    expect(result.found).toBe(true);
    expect(result.content).toContain("Setup line 1.");
    expect(result.content).toContain("Setup line 2.");
    // Must NOT bleed into the next section
    expect(result.content).not.toContain("Usage content");
  });

  it("returns found=false when the heading does not exist", async () => {
    const useCase = new ReadByHeadingUseCase(
      mockRepo(DOC_WITH_TWO_SECTIONS),
      pipeline,
    );

    const result = await useCase.execute({
      path: "note.md",
      heading: "Nonexistent",
      headingDepth: 2,
    });

    expect(result.found).toBe(false);
    expect(result.content).toBe("");
  });

  it("returns content to EOF when heading is the last section", async () => {
    const useCase = new ReadByHeadingUseCase(
      mockRepo(DOC_HEADING_AT_END),
      pipeline,
    );

    const result = await useCase.execute({
      path: "note.md",
      heading: "Last",
      headingDepth: 2,
    });

    expect(result.found).toBe(true);
    expect(result.content).toContain("Last section content line 1.");
    expect(result.content).toContain("Last section content line 2.");
    // Must NOT include the previous section
    expect(result.content).not.toContain("First section content");
  });

  it("includes sub-headings when reading a parent heading", async () => {
    const useCase = new ReadByHeadingUseCase(
      mockRepo(DOC_WITH_SUBHEADINGS),
      pipeline,
    );

    const result = await useCase.execute({
      path: "note.md",
      heading: "Main",
      headingDepth: 1,
    });

    expect(result.found).toBe(true);
    expect(result.content).toContain("Main intro.");
    expect(result.content).toContain("## Sub1");
    expect(result.content).toContain("Sub1 content.");
    expect(result.content).toContain("## Sub2");
    expect(result.content).toContain("Sub2 content.");
    // Must stop at the next h1
    expect(result.content).not.toContain("Another section");
  });
});
