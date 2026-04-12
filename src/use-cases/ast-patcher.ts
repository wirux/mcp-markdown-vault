import type { Root, RootContent } from "mdast";
import { AstNavigator } from "./ast-navigation.js";
import {
  HeadingNotFoundError,
  BlockNotFoundError,
} from "../domain/errors/index.js";
import type { MarkdownPipeline } from "./markdown-pipeline.js";

// ── Public types ───────────────────────────────────────────────────

export interface HeadingTarget {
  heading: string;
  depth: number;
}

export interface BlockTarget {
  blockId: string;
}

export interface PatchOperation {
  type: "append" | "prepend" | "replace";
  target: HeadingTarget | BlockTarget | "document";
  /** Raw markdown to inject. Parsed into AST nodes before splicing. */
  content: string;
}

// ── Patcher ────────────────────────────────────────────────────────

/**
 * Surgical AST patcher — mutates the tree in place.
 *
 * Supports append/prepend/replace targeting:
 * - A heading section (by title + depth)
 * - A block ID (^block-id)
 * - The entire document
 */
export class AstPatcher {
  static apply(tree: Root, op: PatchOperation, pipeline: MarkdownPipeline): void {
    const contentNodes = pipeline.parse(op.content).children;

    if (op.target === "document") {
      AstPatcher.applyDocument(tree, op.type, contentNodes);
    } else if ("heading" in op.target) {
      AstPatcher.applyHeading(tree, op.type, op.target, contentNodes);
    } else {
      AstPatcher.applyBlock(tree, op.type, op.target, contentNodes);
    }
  }

  private static applyDocument(
    tree: Root,
    type: PatchOperation["type"],
    nodes: RootContent[],
  ): void {
    switch (type) {
      case "append":
        tree.children.push(...nodes);
        break;
      case "prepend": {
        // Insert after frontmatter if present
        const insertAt =
          tree.children.length > 0 && tree.children[0]!.type === "yaml"
            ? 1
            : 0;
        tree.children.splice(insertAt, 0, ...nodes);
        break;
      }
      case "replace":
        tree.children = nodes;
        break;
    }
  }

  private static applyHeading(
    tree: Root,
    type: PatchOperation["type"],
    target: HeadingTarget,
    nodes: RootContent[],
  ): void {
    const range = AstNavigator.getHeadingRange(tree, target.heading, target.depth);
    if (!range) {
      throw new HeadingNotFoundError(target.heading, target.depth);
    }

    switch (type) {
      case "append":
        // Insert before the end of the section
        tree.children.splice(range.endIndex, 0, ...nodes);
        break;
      case "prepend":
        // Insert right after the heading node itself
        tree.children.splice(range.startIndex + 1, 0, ...nodes);
        break;
      case "replace":
        // Remove everything in the section except the heading, then insert
        tree.children.splice(
          range.startIndex + 1,
          range.endIndex - range.startIndex - 1,
          ...nodes,
        );
        break;
    }
  }

  private static applyBlock(
    tree: Root,
    type: PatchOperation["type"],
    target: BlockTarget,
    nodes: RootContent[],
  ): void {
    const loc = AstNavigator.findBlockById(tree, target.blockId);
    if (!loc) {
      throw new BlockNotFoundError(target.blockId);
    }

    switch (type) {
      case "append":
        tree.children.splice(loc.index + 1, 0, ...nodes);
        break;
      case "prepend":
        tree.children.splice(loc.index, 0, ...nodes);
        break;
      case "replace":
        tree.children.splice(loc.index, 1, ...nodes);
        break;
    }
  }
}
