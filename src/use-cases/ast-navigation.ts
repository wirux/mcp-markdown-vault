import type { Root, Heading, RootContent, PhrasingContent } from "mdast";

/** Result of locating a node in the AST. */
export interface NodeLocation {
  node: RootContent;
  index: number;
}

/** A heading's section range [startIndex, endIndex) in root.children. */
export interface HeadingRange {
  startIndex: number;
  endIndex: number;
}

/** Summary info for a heading. */
export interface HeadingInfo {
  title: string;
  depth: number;
  index: number;
}

/**
 * Stateless utilities for navigating an mdast tree.
 */
export class AstNavigator {
  /**
   * Find a heading node by its plain-text title and depth.
   * Matching is case-insensitive.
   */
  static findHeading(
    tree: Root,
    title: string,
    depth: number,
  ): NodeLocation | null {
    const lowerTitle = title.toLowerCase();
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i]!;
      if (
        node.type === "heading" &&
        node.depth === depth &&
        AstNavigator.getHeadingText(node).toLowerCase() === lowerTitle
      ) {
        return { node, index: i };
      }
    }
    return null;
  }

  /**
   * Get the range of children owned by a heading section.
   *
   * The range starts at the heading itself and extends until the next
   * heading of equal or lesser depth, or the end of the document.
   */
  static getHeadingRange(
    tree: Root,
    title: string,
    depth: number,
  ): HeadingRange | null {
    const loc = AstNavigator.findHeading(tree, title, depth);
    if (!loc) return null;

    const startIndex = loc.index;
    let endIndex = tree.children.length;

    for (let i = startIndex + 1; i < tree.children.length; i++) {
      const node = tree.children[i]!;
      if (node.type === "heading" && node.depth <= depth) {
        endIndex = i;
        break;
      }
    }

    return { startIndex, endIndex };
  }

  /**
   * Find a block by its block ID (^block-id at end of paragraph).
   */
  static findBlockById(tree: Root, blockId: string): NodeLocation | null {
    const marker = `^${blockId}`;
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i]!;
      if (nodeContainsBlockId(node, marker)) {
        return { node, index: i };
      }
    }
    return null;
  }

  /** Extract plain text from a heading node. */
  static getHeadingText(heading: Heading): string {
    return extractText(heading.children);
  }

  /** List all headings in the document with their indices. */
  static findAllHeadings(tree: Root): HeadingInfo[] {
    const result: HeadingInfo[] = [];
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i]!;
      if (node.type === "heading") {
        result.push({
          title: AstNavigator.getHeadingText(node),
          depth: node.depth,
          index: i,
        });
      }
    }
    return result;
  }
}

/** Recursively extract plain text from phrasing content nodes. */
function extractText(nodes: PhrasingContent[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") {
      text += node.value;
    } else if ("children" in node) {
      text += extractText(node.children as PhrasingContent[]);
    }
  }
  return text;
}

/** Check if a root-level node contains a block ID marker in its text. */
function nodeContainsBlockId(node: RootContent, marker: string): boolean {
  if (node.type === "paragraph") {
    const text = extractText(
      (node as { children: PhrasingContent[] }).children,
    );
    return text.trimEnd().endsWith(marker);
  }
  return false;
}
