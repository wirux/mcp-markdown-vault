import type { Root, RootContent } from "mdast";
import { AstNavigator } from "./ast-navigation.js";
import {
  HeadingNotFoundError,
  BlockNotFoundError,
  UnsafeDeleteTargetError,
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
  type: "append" | "prepend" | "replace" | "delete";
  target: HeadingTarget | BlockTarget | "document";
  content: string;
  replaceMode?: "body" | "section" | undefined;
}

// ── Patcher ────────────────────────────────────────────────────────

export class AstPatcher {
  static apply(tree: Root, op: PatchOperation, pipeline: MarkdownPipeline): void {
    const contentNodes = op.type !== "delete" ? pipeline.parse(op.content).children : [];

    if (op.target === "document") {
      AstPatcher.applyDocument(tree, op.type, contentNodes);
    } else if ("heading" in op.target) {
      AstPatcher.applyHeading(tree, op.type, op.target, contentNodes, op.replaceMode ?? "body");
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
      case "delete":
        throw new UnsafeDeleteTargetError(
          "Cannot delete entire document via edit.delete — use vault.delete to remove files",
        );
        break;
    }
  }

  private static applyHeading(
    tree: Root,
    type: PatchOperation["type"],
    target: HeadingTarget,
    nodes: RootContent[],
    replaceMode: "body" | "section",
  ): void {
    const range = AstNavigator.getHeadingRange(tree, target.heading, target.depth);
    if (!range) {
      throw new HeadingNotFoundError(target.heading, target.depth);
    }

    switch (type) {
      case "append":
        tree.children.splice(range.endIndex, 0, ...nodes);
        break;
      case "prepend":
        tree.children.splice(range.startIndex + 1, 0, ...nodes);
        break;
      case "replace":
        if (replaceMode === "section") {
          tree.children.splice(
            range.startIndex,
            range.endIndex - range.startIndex,
            ...nodes,
          );
        } else {
          tree.children.splice(
            range.startIndex + 1,
            range.endIndex - range.startIndex - 1,
            ...nodes,
          );
        }
        break;
      case "delete":
        tree.children.splice(
          range.startIndex,
          range.endIndex - range.startIndex,
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
      case "delete":
        tree.children.splice(loc.index, 1);
        break;
    }
  }
}
