#!/usr/bin/env node

import { LocalFileSystemAdapter } from "./infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "./infrastructure/in-memory-vector-store.js";
import { OllamaEmbeddingProvider } from "./infrastructure/ollama-embedding.js";
import { TransformersEmbeddingProvider } from "./infrastructure/transformers-embedding.js";
import type { IEmbeddingProvider } from "./domain/interfaces/index.js";
import { WorkflowStateMachine } from "./use-cases/workflow-state.js";
import { VaultIndexer } from "./use-cases/vault-indexer.js";
import { BacklinkIndexService } from "./use-cases/backlink-index.js";
import { MarkdownPipeline } from "./use-cases/markdown-pipeline.js";
import { createMcpServer } from "./presentation/mcp-tools.js";
import {
  parseTransportType,
  startTransport,
} from "./presentation/transport.js";

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
      const response = await fetch(
        `${ollamaUrl.replace(/\/+$/, "")}/api/tags`,
        {
          signal: AbortSignal.timeout(3000),
        },
      );
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
  const transportType = parseTransportType(
    process.env["MCP_TRANSPORT_TYPE"],
  );
  const port = parseInt(process.env["PORT"] ?? "3000", 10);

  // Współdzielone zależności (reużywane przez wszystkie połączenia klientów)
  const fsAdapter = await LocalFileSystemAdapter.create(vaultRoot);
  const vectorStore = new InMemoryVectorStore();
  const embedder = await createEmbeddingProvider();

  // Indeks backlinków — współdzielony między połączeniami
  const backlinkIndex = new BacklinkIndexService(new MarkdownPipeline());

  // Start background indexing (shared across all connections)
  const indexer = new VaultIndexer(vaultRoot, vectorStore, embedder);

  // Podłącz callbacki watchera do indeksu backlinków
  indexer.setOnFileIndexed((relPath, content) => {
    backlinkIndex.updateFile(relPath, content);
  });
  indexer.setOnFileRemoved((relPath) => {
    backlinkIndex.removeFile(relPath);
  });

  // Server factory: each connection gets its own McpServer + WorkflowStateMachine.
  // Shared deps (fs, vectors, embedder, backlinkIndex, indexer) are captured by closure.
  const serverFactory = () =>
    createMcpServer({
      fsAdapter,
      vectorStore,
      embedder,
      workflow: new WorkflowStateMachine(),
      vaultRoot,
      backlinkIndex,
      indexer,
    });

  // Indeksowanie wektorowe + backlinki na starcie
  indexer
    .indexAll()
    .then(async () => {
      // Zbuduj indeks backlinków po zaindeksowaniu vault
      const allFiles = await fsAdapter.listNotes();
      const entries = await Promise.all(
        allFiles.map(async (p) => ({
          path: p,
          content: await fsAdapter.readNote(p),
        })),
      );
      backlinkIndex.rebuildIndex(entries);
      console.error(`Backlink index built: ${allFiles.length} files`);
    })
    .catch((err: unknown) =>
      console.error("Initial indexing failed:", err),
    );
  indexer
    .startWatching({ debounceMs: 1000 })
    .catch((err: unknown) =>
      console.error("Watcher failed to start:", err),
    );

  // Connect via selected transport
  console.error(`Transport: ${transportType}`);
  const handle = await startTransport(transportType, serverFactory, {
    port,
  });

  // Handle shutdown
  process.on("SIGINT", async () => {
    await indexer.stop();
    await handle.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
