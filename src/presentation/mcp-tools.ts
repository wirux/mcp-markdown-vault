import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IEmbeddingProvider, IVectorStore } from "../domain/interfaces/index.js";
import { WorkflowStateMachine } from "../use-cases/workflow-state.js";
import { HintsEngine, type ToolName } from "../use-cases/hints.js";
import { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";
import { AstNavigator } from "../use-cases/ast-navigation.js";
import { AstPatcher } from "../use-cases/ast-patcher.js";
import { FragmentRetriever } from "../use-cases/fragment-retrieval.js";
import { FuzzyMatcher } from "../use-cases/fuzzy-match.js";
import { VaultSearcher } from "../use-cases/vault-search.js";
import { HybridSearcher } from "../use-cases/hybrid-search.js";
import { FreeformEditor } from "../use-cases/freeform-editor.js";
import { ReadByHeadingUseCase } from "../use-cases/read-by-heading.js";
import { BulkReadUseCase } from "../use-cases/bulk-read.js";
import { GetFrontmatterUseCase, SetFrontmatterUseCase } from "../use-cases/frontmatter.js";
import { UpdateFileUseCase } from "../use-cases/update-file.js";
import { DryRunEditor } from "../use-cases/dry-run-edit.js";
import { CreateFromTemplateUseCase } from "../use-cases/create-from-template.js";
import { BatchEditService, type EditOperation } from "../use-cases/batch-edit.js";
import { VaultOverviewService } from "../use-cases/vault-overview.js";
import { BacklinkIndexService } from "../use-cases/backlink-index.js";
import { VaultIndexer } from "../use-cases/vault-indexer.js";
import { MarkdownFileRepository } from "../infrastructure/markdown-file-repository.js";
import { RegexTemplateEngine } from "../infrastructure/regex-template-engine.js";
import { UnifiedDiffService } from "../infrastructure/diff-service.js";
import { DomainError } from "../domain/errors/index.js";

export interface McpDependencies {
  fsAdapter: IFileSystemAdapter;
  vectorStore: IVectorStore;
  embedder: IEmbeddingProvider;
  workflow: WorkflowStateMachine;
  vaultRoot: string;
  backlinkIndex?: BacklinkIndexService | undefined;
  indexer?: VaultIndexer | undefined;
}

/**
 * Creates and configures the MCP server with all 5 semantic tools.
 */
export function createMcpServer(deps: McpDependencies): McpServer {
  const server = new McpServer({
    name: "markdown-vault-mcp",
    version: "0.1.0",
  });

  const pipeline = new MarkdownPipeline();
  const retriever = new FragmentRetriever(pipeline);

  // ── vault tool ──────────────────────────────────────────────────

  server.registerTool("vault", {
    title: "Vault",
    description:
      "Manage vault notes: list, read, create, update, delete, stat, create_from_template. Operates on .md files in the markdown vault.",
    inputSchema: {
      action: z.enum(["list", "read", "create", "update", "delete", "stat", "create_from_template"]),
      path: z.string().optional(),
      directory: z.string().optional(),
      content: z.string().optional(),
      templatePath: z.string().optional().describe("Source template file path (for create_from_template)."),
      variables: z.record(z.string(), z.string()).optional().describe("Key-value variables to inject into template placeholders (for create_from_template)."),
    },
  }, async ({ action, path, directory, content, templatePath, variables }) => {
    return wrapTool(deps.workflow, "vault", async () => {
      switch (action) {
        case "list": {
          const notes = await deps.fsAdapter.listNotes(directory);
          return notes;
        }
        case "read": {
          if (!path) throw new Error("path is required for read");
          const noteContent = await deps.fsAdapter.readNote(path);
          return noteContent;
        }
        case "create": {
          if (!path) throw new Error("path is required for create");
          if (!content) throw new Error("content is required for create");
          await deps.fsAdapter.writeNote(path, content);
          deps.backlinkIndex?.updateFile(path, content);
          deps.indexer?.indexFile(path).catch(() => {/* background */});
          return `Note created: ${path}`;
        }
        case "update": {
          if (!path) throw new Error("path is required for update");
          if (!content) throw new Error("content is required for update");
          const useCase = new UpdateFileUseCase(deps.fsAdapter);
          const result = await useCase.execute({ path, content });
          deps.backlinkIndex?.updateFile(path, content);
          deps.indexer?.indexFile(path).catch(() => {/* background */});
          return result.message;
        }
        case "delete": {
          if (!path) throw new Error("path is required for delete");
          await deps.fsAdapter.deleteNote(path);
          deps.backlinkIndex?.removeFile(path);
          deps.indexer?.removeFile(path).catch(() => {/* background */});
          return `Note deleted: ${path}`;
        }
        case "stat": {
          if (!path) throw new Error("path is required for stat");
          const stat = await deps.fsAdapter.stat(path);
          return stat;
        }
        case "create_from_template": {
          if (!path) throw new Error("path is required for create_from_template");
          if (!templatePath) throw new Error("templatePath is required for create_from_template");
          const engine = new RegexTemplateEngine();
          const useCase = new CreateFromTemplateUseCase(deps.fsAdapter, engine);
          const result = await useCase.execute({
            templatePath,
            destinationPath: path,
            variables,
          });
          // Update indexes after template creation
          const created = await deps.fsAdapter.readNote(path);
          deps.backlinkIndex?.updateFile(path, created);
          deps.indexer?.indexFile(path).catch(() => {/* background */});
          return result.message;
        }
        default:
          throw new Error(`Unknown vault action: ${String(action)}`);
      }
    });
  });

  // ── edit tool ───────────────────────────────────────────────────

  server.registerTool("edit", {
    title: "Edit",
    description:
      "Edit notes. Single mode: provide path, operation, content. Batch mode: provide operations array (max 50, sequential, stops on first error). AST ops (append/prepend/replace) target headings or block IDs with fuzzy matching. Freeform ops (line_replace/string_replace) for line range or literal string. frontmatter_set merges YAML. dryRun=true previews as unified diff without writing.",
    inputSchema: {
      path: z.string().optional().describe("Note path (required for single edit)."),
      operation: z.enum(["append", "prepend", "replace", "line_replace", "string_replace", "frontmatter_set"]).optional().describe("Edit operation (required for single edit)."),
      content: z.string().optional().describe("Content to apply (required for single edit)."),
      heading: z.string().optional(),
      headingDepth: z.number().optional(),
      blockId: z.string().optional(),
      startLine: z.number().optional(),
      endLine: z.number().optional(),
      searchText: z.string().optional(),
      replaceAll: z.boolean().optional(),
      dryRun: z.boolean().optional().describe("If true, returns a preview of changes as a unified diff without saving to disk."),
      operations: z.array(z.object({
        path: z.string(),
        operation: z.enum(["append", "prepend", "replace", "line_replace", "string_replace", "frontmatter_set"]),
        content: z.string(),
        heading: z.string().optional(),
        headingDepth: z.number().optional(),
        blockId: z.string().optional(),
        startLine: z.number().optional(),
        endLine: z.number().optional(),
        searchText: z.string().optional(),
        replaceAll: z.boolean().optional(),
      })).optional().describe("For batch mode: array of edit operations (max 50). Executed sequentially, stops on first error."),
    },
  }, async ({ path: notePath, operation, content, heading, headingDepth, blockId, startLine, endLine, searchText, replaceAll, dryRun, operations }) => {
    return wrapTool(deps.workflow, "edit", async () => {
      // Helper: update indexes after file write
      // Backlinks synchronously (required for consistency), vectors in background
      const syncIndexes = async (filePath: string): Promise<void> => {
        const updated = await deps.fsAdapter.readNote(filePath);
        deps.backlinkIndex?.updateFile(filePath, updated);
        deps.indexer?.indexFile(filePath).catch(() => {/* background */});
      };

      // ── Batch mode ─────────────────────────────────────────────
      if (operations && operations.length > 0) {
        const diffService = new UnifiedDiffService();
        const repo = new MarkdownFileRepository(deps.fsAdapter, pipeline);
        const batchService = new BatchEditService(deps.fsAdapter, pipeline, diffService, repo);
        const batchResult = await batchService.execute({
          operations: operations as EditOperation[],
          dryRun,
        });
        // Update indexes for each successfully edited file (not dryRun)
        if (!dryRun) {
          const edited = new Set<string>();
          for (const op of operations as EditOperation[]) {
            edited.add(op.path);
          }
          for (const p of edited) {
            await syncIndexes(p);
          }
        }
        return batchResult;
      }

      // ── Single mode — validate required fields ─────────────
      if (!notePath) throw new Error("path is required for single edit");
      if (!operation) throw new Error("operation is required for single edit");
      if (content === undefined) throw new Error("content is required for single edit");

      const source = await deps.fsAdapter.readNote(notePath);
      const diffService = new UnifiedDiffService();
      const dryRunEditor = new DryRunEditor(deps.fsAdapter, diffService);

      // Helper: finalize edit and update indexes if not dryRun
      const executeEdit = async (editResult: unknown): Promise<unknown> => {
        if (!(dryRun ?? false)) {
          await syncIndexes(notePath);
        }
        return editResult;
      };

      // ── Freeform operations ─────────────────────────────────────
      if (operation === "line_replace") {
        if (startLine === undefined || endLine === undefined) {
          throw new Error("startLine and endLine are required for line_replace");
        }
        const newContent = FreeformEditor.lineReplace(source, startLine, endLine, content);
        const result = await dryRunEditor.execute({
          path: notePath,
          oldContent: source,
          newContent,
          dryRun: dryRun ?? false,
          operationLabel: `line_replace lines ${startLine}-${endLine}`,
        });
        return executeEdit(result);
      }

      if (operation === "string_replace") {
        if (!searchText) {
          throw new Error("searchText is required for string_replace");
        }
        const newContent = FreeformEditor.stringReplace(source, searchText, content, replaceAll ?? false);
        const result = await dryRunEditor.execute({
          path: notePath,
          oldContent: source,
          newContent,
          dryRun: dryRun ?? false,
          operationLabel: "string_replace",
        });
        return executeEdit(result);
      }

      // ── Frontmatter operation ──────────────────────────────────
      if (operation === "frontmatter_set") {
        const repo = new MarkdownFileRepository(deps.fsAdapter, pipeline);
        const useCase = new SetFrontmatterUseCase(repo);
        const result = await useCase.execute({ path: notePath, content });
        await syncIndexes(notePath);
        return result.message;
      }

      // ── AST operations ──────────────────────────────────────────
      const tree = pipeline.parse(source);

      // Build target
      let target: Parameters<typeof AstPatcher.apply>[1]["target"];

      if (blockId) {
        target = { blockId };
      } else if (heading) {
        const depth = headingDepth ?? 2;

        // Fuzzy match the heading title
        const allHeadings = AstNavigator.findAllHeadings(tree);
        const candidates = allHeadings
          .filter((h) => h.depth === depth)
          .map((h) => h.title);

        if (candidates.length > 0) {
          const matched = FuzzyMatcher.bestMatch(heading, candidates, 0.6);
          if (matched) {
            target = { heading: matched.match, depth };
          } else {
            target = { heading, depth };
          }
        } else {
          target = { heading, depth };
        }
      } else {
        target = "document";
      }

      AstPatcher.apply(tree, { type: operation, target, content }, pipeline);
      const newContent = pipeline.stringify(tree);

      const result = await dryRunEditor.execute({
        path: notePath,
        oldContent: source,
        newContent,
        dryRun: dryRun ?? false,
        operationLabel: operation,
      });
      return executeEdit(result);
    });
  });

  // ── view tool ───────────────────────────────────────────────────

  const vaultSearcher = new VaultSearcher(deps.fsAdapter);
  const hybridSearcher = new HybridSearcher(deps.vectorStore, deps.embedder);

  server.registerTool("view", {
    title: "View",
    description:
      "View and search notes. Actions: search (single-file fragment retrieval), global_search (cross-vault keyword search), semantic_search (cross-vault vector+lexical hybrid), outline (heading structure), read (full content or by heading), frontmatter_get (read YAML frontmatter), bulk_read (read multiple files/headings in one call), backlinks (find all notes linking to a given path).",
    inputSchema: {
      action: z.enum(["search", "global_search", "semantic_search", "outline", "read", "frontmatter_get", "bulk_read", "backlinks"]),
      path: z.string().optional(),
      query: z.string().optional(),
      maxChunks: z.number().optional(),
      heading: z.string().optional(),
      headingDepth: z.number().optional(),
      directory: z.string().optional().describe("Filter search results to a specific directory or path prefix. Example: 'projects/active/'"),
      items: z.array(z.object({
        path: z.string(),
        heading: z.string().optional(),
        headingDepth: z.number().optional(),
      })).optional().describe("For bulk_read: array of files to read, each with optional heading to extract."),
    },
  }, async ({ action, path: notePath, query, maxChunks, heading, headingDepth, directory, items }) => {
    return wrapTool(deps.workflow, "view", async () => {
      switch (action) {
        case "search": {
          if (!notePath) throw new Error("path is required for search");
          if (!query) throw new Error("query is required for search");
          const source = await deps.fsAdapter.readNote(notePath);
          const fragments = retriever.retrieve(source, query, {
            maxChunks: maxChunks ?? 5,
          });
          return fragments.map((f) => ({
            headingPath: f.chunk.headingPath,
            text: f.chunk.text,
            score: Math.round(f.score * 1000) / 1000,
            wordCount: f.chunk.wordCount,
          }));
        }
        case "global_search": {
          if (!query) throw new Error("query is required for global_search");
          const results = await vaultSearcher.search(query, {
            maxResults: maxChunks ?? 20,
            directory,
          });
          return results.map((r) => ({
            filePath: r.filePath,
            headingPath: r.headingPath,
            text: r.text,
            score: Math.round(r.score * 1000) / 1000,
            wordCount: r.wordCount,
          }));
        }
        case "semantic_search": {
          if (!query) throw new Error("query is required for semantic_search");
          const results = await hybridSearcher.search(query, {
            k: maxChunks ?? 10,
            directory,
          });
          return results.map((r) => ({
            docPath: r.docPath,
            headingPath: r.headingPath,
            text: r.text,
            score: Math.round(r.score * 1000) / 1000,
            vectorScore: Math.round(r.vectorScore * 1000) / 1000,
            lexicalScore: Math.round(r.lexicalScore * 1000) / 1000,
          }));
        }
        case "outline": {
          if (!notePath) throw new Error("path is required for outline");
          const source = await deps.fsAdapter.readNote(notePath);
          const tree = pipeline.parse(source);
          return AstNavigator.findAllHeadings(tree);
        }
        case "read": {
          if (!notePath) throw new Error("path is required for read");
          if (heading) {
            const repo = new MarkdownFileRepository(deps.fsAdapter, pipeline);
            const useCase = new ReadByHeadingUseCase(repo, pipeline);
            const result = await useCase.execute({
              path: notePath,
              heading,
              headingDepth,
            });
            return result;
          }
          const content = await deps.fsAdapter.readNote(notePath);
          return content;
        }
        case "frontmatter_get": {
          if (!notePath) throw new Error("path is required for frontmatter_get");
          const repo = new MarkdownFileRepository(deps.fsAdapter, pipeline);
          const useCase = new GetFrontmatterUseCase(repo);
          const result = await useCase.execute({ path: notePath });
          return result;
        }
        case "bulk_read": {
          if (!items || items.length === 0) {
            return { results: [] };
          }
          const repo = new MarkdownFileRepository(deps.fsAdapter, pipeline);
          const headingReader = new ReadByHeadingUseCase(repo, pipeline);
          const bulkUseCase = new BulkReadUseCase(deps.fsAdapter, headingReader);
          const result = await bulkUseCase.execute({ items });
          return result;
        }
        case "backlinks": {
          if (!notePath) throw new Error("path is required for backlinks");
          if (!deps.backlinkIndex) {
            return { target: notePath, backlinks: [], count: 0 };
          }
          const backlinks = deps.backlinkIndex.getBacklinks(notePath);
          return { target: notePath, backlinks, count: backlinks.length };
        }
        default:
          throw new Error(`Unknown view action: ${String(action)}`);
      }
    });
  });

  // ── workflow tool ───────────────────────────────────────────────

  server.registerTool("workflow", {
    title: "Workflow",
    description:
      "Manage agent workflow state: check status, fire transitions, view history, or reset. Based on a Petri net state machine.",
    inputSchema: {
      action: z.enum(["status", "transition", "history", "reset"]),
      transition: z.string().optional(),
    },
  }, async ({ action, transition }) => {
    return wrapTool(deps.workflow, "workflow", async () => {
      switch (action) {
        case "status": {
          return {
            currentState: deps.workflow.currentPlace,
            availableTransitions: deps.workflow
              .availableTransitions()
              .map((t) => t.name),
          };
        }
        case "transition": {
          if (!transition) throw new Error("transition name is required");
          deps.workflow.fire(transition);
          return {
            currentState: deps.workflow.currentPlace,
            firedTransition: transition,
          };
        }
        case "history": {
          return deps.workflow.getHistory();
        }
        case "reset": {
          deps.workflow.hardReset();
          return { currentState: deps.workflow.currentPlace };
        }
        default:
          throw new Error(`Unknown workflow action: ${String(action)}`);
      }
    });
  });

  // ── system tool ─────────────────────────────────────────────────

  server.registerTool("system", {
    title: "System",
    description:
      "System administration: check status, get indexing info, vault structure overview, and manage the server.",
    inputSchema: {
      action: z.enum(["status", "reindex", "overview"]),
      maxDepth: z.number().optional().describe("Maximum folder depth for overview (default 3)."),
    },
  }, async ({ action, maxDepth }) => {
    return wrapTool(deps.workflow, "system", async () => {
      switch (action) {
        case "status": {
          const indexedDocs = await deps.vectorStore.size();
          return {
            vaultRoot: deps.vaultRoot,
            indexedDocuments: indexedDocs,
            backlinkIndexSize: deps.backlinkIndex?.indexSize ?? 0,
            workflowState: deps.workflow.currentPlace,
          };
        }
        case "reindex": {
          if (deps.indexer) {
            // Run re-indexing asynchronously (don't block the response)
            deps.indexer.indexAll()
              .then(async () => {
                if (deps.backlinkIndex) {
                  const allFiles = await deps.fsAdapter.listNotes();
                  const entries = await Promise.all(
                    allFiles.map(async (p) => ({
                      path: p,
                      content: await deps.fsAdapter.readNote(p),
                    })),
                  );
                  deps.backlinkIndex.rebuildIndex(entries);
                }
              })
              .catch((err: unknown) =>
                console.error("Re-indexing failed:", err),
              );
          }
          return { message: "Re-indexing triggered (async)" };
        }
        case "overview": {
          const overviewService = new VaultOverviewService(deps.fsAdapter);
          return overviewService.getOverview(maxDepth);
        }
        default:
          throw new Error(`Unknown system action: ${String(action)}`);
      }
    });
  });

  return server;
}

// ── Helpers ────────────────────────────────────────────────────────

async function wrapTool<T>(
  workflow: WorkflowStateMachine,
  toolName: ToolName,
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await fn();
    const enriched = HintsEngine.formatResponse(workflow, toolName, result);
    return {
      content: [{ type: "text", text: JSON.stringify(enriched) }],
    };
  } catch (err) {
    const message =
      err instanceof DomainError
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}
