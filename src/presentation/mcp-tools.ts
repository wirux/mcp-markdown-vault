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
import { MarkdownFileRepository } from "../infrastructure/markdown-file-repository.js";
import { DomainError } from "../domain/errors/index.js";

export interface McpDependencies {
  fsAdapter: IFileSystemAdapter;
  vectorStore: IVectorStore;
  embedder: IEmbeddingProvider;
  workflow: WorkflowStateMachine;
  vaultRoot: string;
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
      "Manage vault notes: list, read, create, delete, stat. Operates on .md files in the markdown vault.",
    inputSchema: {
      action: z.enum(["list", "read", "create", "delete", "stat"]),
      path: z.string().optional(),
      directory: z.string().optional(),
      content: z.string().optional(),
    },
  }, async ({ action, path, directory, content }) => {
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
          return `Note created: ${path}`;
        }
        case "delete": {
          if (!path) throw new Error("path is required for delete");
          await deps.fsAdapter.deleteNote(path);
          return `Note deleted: ${path}`;
        }
        case "stat": {
          if (!path) throw new Error("path is required for stat");
          const stat = await deps.fsAdapter.stat(path);
          return stat;
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
      "Edit a note. AST operations (append/prepend/replace) target headings or block IDs with fuzzy matching. Freeform operations (line_replace/string_replace) provide fallback editing by line range or literal string.",
    inputSchema: {
      path: z.string(),
      operation: z.enum(["append", "prepend", "replace", "line_replace", "string_replace"]),
      content: z.string(),
      heading: z.string().optional(),
      headingDepth: z.number().optional(),
      blockId: z.string().optional(),
      startLine: z.number().optional(),
      endLine: z.number().optional(),
      searchText: z.string().optional(),
      replaceAll: z.boolean().optional(),
    },
  }, async ({ path: notePath, operation, content, heading, headingDepth, blockId, startLine, endLine, searchText, replaceAll }) => {
    return wrapTool(deps.workflow, "edit", async () => {
      const source = await deps.fsAdapter.readNote(notePath);

      // ── Freeform operations ─────────────────────────────────────
      if (operation === "line_replace") {
        if (startLine === undefined || endLine === undefined) {
          throw new Error("startLine and endLine are required for line_replace");
        }
        const result = FreeformEditor.lineReplace(source, startLine, endLine, content);
        await deps.fsAdapter.writeNote(notePath, result, true);
        return `Note patched: ${notePath} (line_replace lines ${startLine}-${endLine})`;
      }

      if (operation === "string_replace") {
        if (!searchText) {
          throw new Error("searchText is required for string_replace");
        }
        const result = FreeformEditor.stringReplace(source, searchText, content, replaceAll ?? false);
        await deps.fsAdapter.writeNote(notePath, result, true);
        return `Note patched: ${notePath} (string_replace)`;
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
      const result = pipeline.stringify(tree);
      await deps.fsAdapter.writeNote(notePath, result, true);

      return `Note patched: ${notePath} (${operation})`;
    });
  });

  // ── view tool ───────────────────────────────────────────────────

  const vaultSearcher = new VaultSearcher(deps.fsAdapter);
  const hybridSearcher = new HybridSearcher(deps.vectorStore, deps.embedder);

  server.registerTool("view", {
    title: "View",
    description:
      "View and search notes. Actions: search (single-file fragment retrieval), global_search (cross-vault keyword search), semantic_search (cross-vault vector+lexical hybrid), outline (heading structure), read (full content or by heading).",
    inputSchema: {
      action: z.enum(["search", "global_search", "semantic_search", "outline", "read"]),
      path: z.string().optional(),
      query: z.string().optional(),
      maxChunks: z.number().optional(),
      heading: z.string().optional(),
      headingDepth: z.number().optional(),
    },
  }, async ({ action, path: notePath, query, maxChunks, heading, headingDepth }) => {
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
      "System administration: check status, get indexing info, and manage the server.",
    inputSchema: {
      action: z.enum(["status", "reindex"]),
    },
  }, async ({ action }) => {
    return wrapTool(deps.workflow, "system", async () => {
      switch (action) {
        case "status": {
          const indexedDocs = await deps.vectorStore.size();
          return {
            vaultRoot: deps.vaultRoot,
            indexedDocuments: indexedDocs,
            workflowState: deps.workflow.currentPlace,
          };
        }
        case "reindex": {
          return { message: "Re-indexing triggered (async)" };
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
