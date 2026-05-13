#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LocalFileSystemAdapter } from "./infrastructure/local-fs-adapter.js";
import { ChokidarFileWatcher } from "./infrastructure/chokidar-file-watcher.js";
import { createVectorStore } from "./infrastructure/vector-store-factory.js";
import { OllamaEmbeddingProvider } from "./infrastructure/ollama-embedding.js";
import { TransformersEmbeddingProvider } from "./infrastructure/transformers-embedding.js";
import {
  validateOllama,
  validateVectorStore,
  StartupError,
} from "./infrastructure/startup-checks.js";
import type { IEmbeddingProvider } from "./domain/interfaces/index.js";
import type { IFileSystemAdapter } from "./domain/interfaces/file-system-adapter.js";
import { WorkflowStateMachine } from "./use-cases/workflow-state.js";
import { VaultIndexer } from "./use-cases/vault-indexer.js";
import { BacklinkIndexService } from "./use-cases/backlink-index.js";
import { MarkdownPipeline } from "./use-cases/markdown-pipeline.js";
import { VaultAutoInitService, type AutoInitResult } from "./use-cases/vault-auto-init.js";
import { composeInstructions } from "./use-cases/instructions-composer.js";
import { createMcpServer, type McpDependencies } from "./presentation/mcp-tools.js";
import {
  parseTransportType,
  startTransport,
} from "./presentation/transport.js";
import {
  parseVaultContextConfig,
  logDeprecationWarning,
  type VaultContextMode,
} from "./use-cases/vault-context-config.js";
import { OverviewManager } from "./use-cases/overview-manager.js";

export const DEFAULT_VAULT_SCOPE = "general markdown notes vault";

export interface VaultOrientation {
  initResult: AutoInitResult;
  getVaultScope: () => string;
  instructions: string;
}

export async function initializeVaultOrientation(deps: {
  fsAdapter: IFileSystemAdapter;
  mode: VaultContextMode;
  logger?: Pick<Console, "error">;
}): Promise<VaultOrientation> {
  const logger = deps.logger ?? console;
  const autoInit = new VaultAutoInitService({
    fsAdapter: deps.fsAdapter,
    mode: deps.mode,
  });
  const initResult = await autoInit.initialize().catch((err: unknown) => {
    logger.error("Vault auto-init failed:", err);
    return {
      contractCreated: false,
      overviewCreated: false,
      warnings: [],
    } satisfies AutoInitResult;
  });

  if (initResult.contractCreated) {
    logger.error("meta/contract.md created");
  }
  if (initResult.overviewCreated) {
    logger.error("meta/overview.md created");
  }
  for (const warning of initResult.warnings) {
    logger.error(`[warn] ${warning}`);
  }

  const getVaultScope = makeVaultScopeProvider(deps.fsAdapter);

  return {
    initResult,
    getVaultScope,
    instructions: composeInstructions(DEFAULT_VAULT_SCOPE),
  };
}

export function makeVaultScopeProvider(
  fsAdapter: IFileSystemAdapter,
): () => string {
  let cached: string = DEFAULT_VAULT_SCOPE;

  const refresh = (): void => {
    fsAdapter.readNote("meta/overview.md").then((content) => {
      const firstMeaningfulLine = content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith("---") && !l.startsWith("#") && !l.startsWith("schema_version") && !l.startsWith("generated") && !l.startsWith("managed_by"));
      cached = firstMeaningfulLine ?? DEFAULT_VAULT_SCOPE;
    }).catch(() => { cached = DEFAULT_VAULT_SCOPE; });
  };

  refresh();
  return () => cached;
}

export function createServerFactory(
  deps: Omit<McpDependencies, "workflow">,
): () => ReturnType<typeof createMcpServer> {
  return () =>
    createMcpServer({
      ...deps,
      workflow: new WorkflowStateMachine(),
    });
}

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
  const config = parseVaultContextConfig(process.env);
  logDeprecationWarning(config);
  const transportType = parseTransportType(
    process.env["MCP_TRANSPORT_TYPE"],
  );
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const authToken = process.env["MCP_AUTH_TOKEN"];
  const hostBindAddress = process.env["HOST_BIND_ADDRESS"] ?? "127.0.0.1";
  const bodyLimit = process.env["BODY_LIMIT_BYTES"] ?? "1mb";
  const ollamaUrl = process.env["OLLAMA_URL"];
  const ollamaModel = process.env["OLLAMA_MODEL"] ?? "nomic-embed-text";
  const qdrantUrl = process.env["VECTOR_STORE_URL"];
  const qdrantCollection =
    process.env["VECTOR_STORE_COLLECTION"] ?? "markdown_vault";
  const allowReset = process.env["VECTOR_STORE_RESET"] === "true";

  const fsAdapter = await LocalFileSystemAdapter.create(vaultRoot);
  const { getVaultScope, instructions } = await initializeVaultOrientation({
    fsAdapter,
    mode: config.mode,
  });

  if (ollamaUrl !== undefined) {
    await validateOllama(ollamaUrl, ollamaModel);
  }

  const embedder = await createEmbeddingProvider();

  await validateVectorStore({
    qdrantUrl,
    qdrantCollection,
    vaultPath: vaultRoot,
    expectedDimensions: embedder.dimensions,
    expectedModel: embedder.modelName,
    allowReset,
  });

  const vectorStore = await createVectorStore(
    vaultRoot,
    embedder.modelName,
    embedder.dimensions,
  );

  const backlinkIndex = new BacklinkIndexService(new MarkdownPipeline());

  const fileWatcher = new ChokidarFileWatcher();
  const indexer = new VaultIndexer(
    vaultRoot,
    vectorStore,
    embedder,
    fileWatcher,
    fsAdapter,
  );

  indexer.addOnFileIndexed((relPath, content) => {
    backlinkIndex.updateFile(relPath, content);
  });
  indexer.addOnFileRemoved((relPath) => {
    backlinkIndex.removeFile(relPath);
  });

  let overviewManager: OverviewManager | undefined;
  if (config.mode === "auto") {
    overviewManager = new OverviewManager({ fsAdapter });
    indexer.addOnThresholdReached(() => {
      overviewManager!.writeOverview().catch((err: unknown) =>
        console.error("Overview refresh failed:", err),
      );
      indexer.resetChangeCount();
    });
  }

  const serverFactory = createServerFactory({
    fsAdapter,
    vectorStore,
    embedder,
    vaultRoot,
    backlinkIndex,
    indexer,
    instructions,
    getVaultScope,
  });

  indexer
    .indexAll()
    .then(async () => {
      const allFiles = await fsAdapter.listNotes();
      const entries = await Promise.all(
        allFiles.map(async (p) => ({
          path: p,
          content: await fsAdapter.readNote(p),
        })),
      );
      backlinkIndex.rebuildIndex(entries);
      console.error(`Backlink index built: ${allFiles.length} files`);
      if (overviewManager !== undefined) {
        await overviewManager.writeOverview().catch((err: unknown) =>
          console.error("Initial overview generation failed:", err),
        );
      }
    })
    .catch((err: unknown) =>
      console.error("Initial indexing failed:", err),
    );
  indexer
    .startWatching({ debounceMs: 1000 })
    .catch((err: unknown) =>
      console.error("Watcher failed to start:", err),
    );

  console.error(`Transport: ${transportType}`);
  if (authToken) {
    console.error("Bearer auth: enabled");
  }
  const handle = await startTransport(transportType, serverFactory, {
    port,
    authToken,
    hostBindAddress,
    bodyLimit,
  });

  // Handle shutdown
  const shutdown = async () => {
    await indexer.stop();
    await handle.shutdown();
    await vectorStore.save();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Periodic flush every 60 seconds
  setInterval(async () => {
    await vectorStore.save().catch(console.error);
  }, 60_000).unref();
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(realpathSync(entryPoint)).href;
}

if (isDirectExecution()) {
  main().catch((err) => {
    if (err instanceof StartupError) {
      console.error(`\nStartup check failed: ${err.message}`);
      console.error(`  → ${err.hint}\n`);
    } else {
      console.error("Fatal:", err);
    }
    process.exit(1);
  });
}
