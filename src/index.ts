#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalFileSystemAdapter } from "./infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "./infrastructure/in-memory-vector-store.js";
import { OllamaEmbeddingProvider } from "./infrastructure/ollama-embedding.js";
import { WorkflowStateMachine } from "./use-cases/workflow-state.js";
import { VaultIndexer } from "./use-cases/vault-indexer.js";
import { createMcpServer } from "./presentation/mcp-tools.js";

async function main(): Promise<void> {
  const vaultRoot = process.env["VAULT_PATH"] ?? "/vault";
  const ollamaUrl = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
  const ollamaModel = process.env["OLLAMA_MODEL"] ?? "nomic-embed-text";
  const ollamaDimensions = parseInt(
    process.env["OLLAMA_DIMENSIONS"] ?? "768",
    10,
  );

  const fsAdapter = await LocalFileSystemAdapter.create(vaultRoot);
  const vectorStore = new InMemoryVectorStore();
  const embedder = new OllamaEmbeddingProvider({
    baseUrl: ollamaUrl,
    model: ollamaModel,
    dimensions: ollamaDimensions,
  });
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
