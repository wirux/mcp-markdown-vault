import { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstNavigator } from "./ast-navigation.js";
import type { Heading, RootContent } from "mdast";

export interface Chunk {
  /** Breadcrumb path of heading titles, e.g. ["Root", "Section A", "Sub A.1"] */
  headingPath: string[];
  /** Plain text of the chunk (heading line excluded). */
  text: string;
  /** 1-based start line in the source document. */
  startLine: number;
  /** 1-based end line (inclusive) in the source document. */
  endLine: number;
  /** Number of words in `text`. */
  wordCount: number;
}

/**
 * Splits Markdown into chunks at heading boundaries, preserving the
 * logical heading hierarchy as a breadcrumb path.
 *
 * Stateless — shared pipeline instance is created once.
 */
export class MarkdownChunker {
  private readonly pipeline: MarkdownPipeline;

  constructor(pipeline?: MarkdownPipeline) {
    this.pipeline = pipeline ?? new MarkdownPipeline();
  }

  chunk(markdown: string): Chunk[] {
    const trimmed = markdown.trim();
    if (trimmed.length === 0) return [];

    const tree = this.pipeline.parse(markdown);
    const children = tree.children;

    if (children.length === 0) return [];

    // Build raw sections: each section is a group of consecutive nodes
    // delimited by heading boundaries.
    const sections = this.buildSections(children);

    // Filter out empty sections (e.g. frontmatter-only)
    return sections.filter((c) => c.wordCount > 0);
  }

  private buildSections(children: RootContent[]): Chunk[] {
    const chunks: Chunk[] = [];

    // Heading stack tracks the current nesting, keyed by depth.
    // headingStack[depth] = title
    const headingStack: Map<number, string> = new Map();

    let currentNodes: RootContent[] = [];
    let currentHeadingPath: string[] = [];
    let sectionStartLine = 1;

    for (const node of children) {
      if (node.type === "yaml") {
        // Skip frontmatter entirely
        continue;
      }

      if (node.type === "heading") {
        // Flush the current section
        if (currentNodes.length > 0) {
          const chunk = this.buildChunk(
            currentNodes,
            currentHeadingPath,
            sectionStartLine,
          );
          chunks.push(chunk);
        }

        const heading = node as Heading;
        const title = AstNavigator.getHeadingText(heading);
        const depth = heading.depth;

        // Update heading stack: clear all deeper levels
        for (const [d] of headingStack) {
          if (d >= depth) headingStack.delete(d);
        }
        headingStack.set(depth, title);

        // Rebuild heading path from stack (sorted by depth)
        currentHeadingPath = [...headingStack.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, t]) => t);

        currentNodes = [];
        sectionStartLine = node.position?.start.line ?? sectionStartLine;
      } else {
        currentNodes.push(node);
      }
    }

    // Flush the last section
    if (currentNodes.length > 0) {
      const chunk = this.buildChunk(
        currentNodes,
        currentHeadingPath,
        sectionStartLine,
      );
      chunks.push(chunk);
    }

    return chunks;
  }

  private buildChunk(
    nodes: RootContent[],
    headingPath: string[],
    sectionStartLine: number,
  ): Chunk {
    const bodyText = this.extractPlainText(nodes);

    // Prepend heading path so heading keywords are scoreable
    const headingPrefix =
      headingPath.length > 0 ? headingPath.join(" — ") + "\n" : "";
    const text = (headingPrefix + bodyText).trim();

    const startLine = sectionStartLine;
    const lastNode = nodes[nodes.length - 1];
    const endLine = lastNode?.position?.end.line ?? startLine;

    return {
      headingPath: [...headingPath],
      text,
      startLine,
      endLine,
      wordCount: countWords(text),
    };
  }

  private extractPlainText(nodes: RootContent[]): string {
    const parts: string[] = [];
    for (const node of nodes) {
      parts.push(nodeToText(node));
    }
    return parts.join("\n").trim();
  }
}

/** Recursively extract plain text from any mdast node. */
function nodeToText(node: RootContent): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("children" in node) {
    return (node.children as RootContent[]).map(nodeToText).join(" ");
  }
  return "";
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
