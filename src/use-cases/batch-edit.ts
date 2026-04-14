import yaml from "js-yaml";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IDiffService } from "../domain/interfaces/diff-service.js";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import { BatchLimitExceededError } from "../domain/errors/index.js";
import type { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstNavigator } from "./ast-navigation.js";
import { AstPatcher } from "./ast-patcher.js";
import { FuzzyMatcher } from "./fuzzy-match.js";
import { FreeformEditor } from "./freeform-editor.js";
import { DryRunEditor } from "./dry-run-edit.js";

const MAX_OPERATIONS = 50;

/** Pojedyncza operacja edycji w batch. */
export interface EditOperation {
  path: string;
  operation: "append" | "prepend" | "replace" | "line_replace" | "string_replace" | "frontmatter_set";
  content: string;
  heading?: string | undefined;
  headingDepth?: number | undefined;
  blockId?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  searchText?: string | undefined;
  replaceAll?: boolean | undefined;
}

/** Batch edit request. */
export interface BatchEditRequest {
  operations: EditOperation[];
  dryRun?: boolean | undefined;
}

/** Result of a single operation. */
export interface BatchEditResult {
  index: number;
  path: string;
  action: string;
  status: "success" | "error";
  diff?: string | undefined;
  error?: string | undefined;
}

/** Batch edit response. */
export interface BatchEditResponse {
  results: BatchEditResult[];
  totalRequested: number;
  totalSucceeded: number;
  totalFailed: number;
  stoppedAtIndex?: number | undefined;
}

/**
 * Service that executes multiple edit operations sequentially.
 * Stops on first error.
 * Delegates to the same use cases as single edits.
 */
export class BatchEditService {
  private readonly dryRunEditor: DryRunEditor;

  constructor(
    private readonly fsAdapter: IFileSystemAdapter,
    private readonly pipeline: MarkdownPipeline,
    diffService: IDiffService,
    _markdownRepo: IMarkdownRepository,
  ) {
    this.dryRunEditor = new DryRunEditor(fsAdapter, diffService);
  }

  async execute(request: BatchEditRequest): Promise<BatchEditResponse> {
    const { operations, dryRun } = request;

    if (operations.length > MAX_OPERATIONS) {
      throw new BatchLimitExceededError(operations.length, MAX_OPERATIONS);
    }

    if (operations.length === 0) {
      return {
        results: [],
        totalRequested: 0,
        totalSucceeded: 0,
        totalFailed: 0,
      };
    }

    const results: BatchEditResult[] = [];
    let totalSucceeded = 0;
    let totalFailed = 0;
    let stoppedAtIndex: number | undefined;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]!;
      try {
        const editResult = await this.executeSingle(op, dryRun ?? false);
        results.push({
          index: i,
          path: op.path,
          action: op.operation,
          status: "success",
          diff: editResult.diff,
        });
        totalSucceeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          index: i,
          path: op.path,
          action: op.operation,
          status: "error",
          error: message,
        });
        totalFailed++;
        stoppedAtIndex = i;
        break;
      }
    }

    return {
      results,
      totalRequested: operations.length,
      totalSucceeded,
      totalFailed,
      stoppedAtIndex,
    };
  }

  // Execute a single operation — delegates to existing use cases
  private async executeSingle(
    op: EditOperation,
    dryRun: boolean,
  ): Promise<{ message: string; diff?: string | undefined }> {
    const source = await this.fsAdapter.readNote(op.path);

    // ── Freeform: line_replace ────────────────────────────────────
    if (op.operation === "line_replace") {
      if (op.startLine === undefined || op.endLine === undefined) {
        throw new Error("startLine and endLine are required for line_replace");
      }
      const newContent = FreeformEditor.lineReplace(
        source, op.startLine, op.endLine, op.content,
      );
      return this.dryRunEditor.execute({
        path: op.path,
        oldContent: source,
        newContent,
        dryRun,
        operationLabel: `line_replace lines ${op.startLine}-${op.endLine}`,
      });
    }

    // ── Freeform: string_replace ─────────────────────────────────
    if (op.operation === "string_replace") {
      if (!op.searchText) {
        throw new Error("searchText is required for string_replace");
      }
      const newContent = FreeformEditor.stringReplace(
        source, op.searchText, op.content, op.replaceAll ?? false,
      );
      return this.dryRunEditor.execute({
        path: op.path,
        oldContent: source,
        newContent,
        dryRun,
        operationLabel: "string_replace",
      });
    }

    // ── Frontmatter ──────────────────────────────────────────────
    if (op.operation === "frontmatter_set") {
      const data = JSON.parse(op.content) as Record<string, unknown>;
      const tree = this.pipeline.parse(source);
      const yamlNode = tree.children.find((n) => n.type === "yaml");

      if (yamlNode && yamlNode.type === "yaml") {
        const existing = yaml.load(yamlNode.value);
        const merged = Object.assign(
          {},
          typeof existing === "object" && existing !== null ? existing : {},
          data,
        );
        yamlNode.value = yaml.dump(merged).trimEnd();
      } else {
        tree.children.unshift({
          type: "yaml",
          value: yaml.dump(data).trimEnd(),
        });
      }

      const newContent = this.pipeline.stringify(tree);
      return this.dryRunEditor.execute({
        path: op.path,
        oldContent: source,
        newContent,
        dryRun,
        operationLabel: "frontmatter_set",
      });
    }

    // ── Operacje AST (append / prepend / replace) ────────────────
    const tree = this.pipeline.parse(source);

    let target: Parameters<typeof AstPatcher.apply>[1]["target"];
    if (op.blockId) {
      target = { blockId: op.blockId };
    } else if (op.heading) {
      const depth = op.headingDepth ?? 2;
      const allHeadings = AstNavigator.findAllHeadings(tree);
      const candidates = allHeadings
        .filter((h) => h.depth === depth)
        .map((h) => h.title);
      if (candidates.length > 0) {
        const matched = FuzzyMatcher.bestMatch(op.heading, candidates, 0.6);
        target = matched
          ? { heading: matched.match, depth }
          : { heading: op.heading, depth };
      } else {
        target = { heading: op.heading, depth };
      }
    } else {
      target = "document";
    }

    AstPatcher.apply(tree, { type: op.operation, target, content: op.content }, this.pipeline);
    const newContent = this.pipeline.stringify(tree);

    return this.dryRunEditor.execute({
      path: op.path,
      oldContent: source,
      newContent,
      dryRun,
      operationLabel: op.operation,
    });
  }
}
