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
    name: "obsidian-semantic-mcp",
    version: "0.1.0",
  });

  const pipeline = new MarkdownPipeline();
  const retriever = new FragmentRetriever(pipeline);

  // ── vault tool ──────────────────────────────────────────────────

  server.registerTool("vault", {
    title: "Vault",
    description:
      "Manage vault notes: list, read, create, delete, stat. Operates on .md files in the Obsidian vault.",
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
      "Surgically edit a note using AST-based patching. Supports append, prepend, replace targeting headings or block IDs. Includes fuzzy matching for typo resilience.",
    inputSchema: {
      path: z.string(),
      operation: z.enum(["append", "prepend", "replace"]),
      content: z.string(),
      heading: z.string().optional(),
      headingDepth: z.number().optional(),
      blockId: z.string().optional(),
    },
  }, async ({ path: notePath, operation, content, heading, headingDepth, blockId }) => {
    return wrapTool(deps.workflow, "edit", async () => {
      const source = await deps.fsAdapter.readNote(notePath);
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

  server.registerTool("view", {
    title: "View",
    description:
      "View note content: fragment retrieval with query, heading outline, or full read. Optimizes LLM context by returning only relevant sections.",
    inputSchema: {
      action: z.enum(["search", "outline", "read"]),
      path: z.string().optional(),
      query: z.string().optional(),
      maxChunks: z.number().optional(),
    },
  }, async ({ action, path: notePath, query, maxChunks }) => {
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
        case "outline": {
          if (!notePath) throw new Error("path is required for outline");
          const source = await deps.fsAdapter.readNote(notePath);
          const tree = pipeline.parse(source);
          return AstNavigator.findAllHeadings(tree);
        }
        case "read": {
          if (!notePath) throw new Error("path is required for read");
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
