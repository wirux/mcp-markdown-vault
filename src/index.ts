#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalFileSystemAdapter } from "./infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "./infrastructure/in-memory-vector-store.js";
import { OllamaEmbeddingProvider } from "./infrastructure/ollama-embedding.js";
import { TransformersEmbeddingProvider } from "./infrastructure/transformers-embedding.js";
import type { IEmbeddingProvider } from "./domain/interfaces/index.js";
import { WorkflowStateMachine } from "./use-cases/workflow-state.js";
import { VaultIndexer } from "./use-cases/vault-indexer.js";
import { createMcpServer } from "./presentation/mcp-tools.js";

/**
 * Strategy: pick the embedding provider based on environment.
 *
 * - OLLAMA_URL explicitly set → try Ollama; if unreachable, fall back to local.
 * - OLLAMA_URL not set → use local @huggingface/transformers directly (zero-setup).
 */
async function createEmbeddingProvider(): Promise<IEmbeddingProvider> {
  const ollamaUrl = process.env["OLLAMA_URL"];

  if (ollamaUrl !== undefined) {
    const model = process.env["OLLAMA_MODEL"] ?? "nomic-embed-text";
    const dimensions = parseInt(
      process.env["OLLAMA_DIMENSIONS"] ?? "768",
      10,
    );

    try {
      const response = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        console.error(`Embedding provider: Ollama (${ollamaUrl})`);
        return new OllamaEmbeddingProvider({
          baseUrl: ollamaUrl,
          model,
          dimensions,
        });
      }
    } catch {
      // Ollama not reachable — fall through
    }

    console.error(
      `Ollama at ${ollamaUrl} not reachable, falling back to local embeddings`,
    );
  } else {
    console.error("Embedding provider: local (@huggingface/transformers)");
  }

  return new TransformersEmbeddingProvider();
}

async function main(): Promise<void> {
  const vaultRoot = process.env["VAULT_PATH"] ?? "/vault";

  const fsAdapter = await LocalFileSystemAdapter.create(vaultRoot);
  const vectorStore = new InMemoryVectorStore();
  const embedder = await createEmbeddingProvider();
  const workflow = new WorkflowStateMachine();

  const server = createMcpServer({
    fsAdapter,
    vectorStore,
    embedder,
    workflow,
    vaultRoot,
  });

  // Start background indexing
  const indexer = new VaultIndexer(vaultRoot, vectorStore, embedder);
  indexer
    .indexAll()
    .catch((err: unknown) =>
      console.error("Initial indexing failed:", err),
    );
  indexer
    .startWatching({ debounceMs: 1000 })
    .catch((err: unknown) =>
      console.error("Watcher failed to start:", err),
    );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle shutdown
  process.on("SIGINT", async () => {
    await indexer.stop();
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
