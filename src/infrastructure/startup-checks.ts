import fs from "node:fs/promises";
import path from "node:path";

export class StartupError extends Error {
  public readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "StartupError";
    this.hint = hint;
  }
}

// ── Ollama ──────────────────────────────────────────────────────────

export async function validateOllama(
  ollamaUrl: string,
  model: string,
): Promise<void> {
  const baseUrl = ollamaUrl.replace(/\/+$/, "");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StartupError(
      `Ollama is not reachable at ${ollamaUrl}`,
      `Ensure Ollama is running ("ollama serve") or unset OLLAMA_URL to use local embeddings.`,
    );
  }

  if (!response.ok) {
    throw new StartupError(
      `Ollama returned HTTP ${response.status}`,
      `Check Ollama health at ${ollamaUrl}. Unset OLLAMA_URL to fall back to local embeddings.`,
    );
  }

  const data = (await response.json()) as {
    models?: Array<{ name: string }>;
  };
  const models = data.models ?? [];
  const found = models.some(
    (m) => m.name === model || m.name.startsWith(`${model}:`),
  );

  if (!found) {
    const available =
      models.map((m) => m.name).join(", ") || "(none)";
    throw new StartupError(
      `Ollama model "${model}" is not pulled`,
      `Run "ollama pull ${model}" or set OLLAMA_MODEL to one of: ${available}`,
    );
  }
}

// ── Vector store compatibility ──────────────────────────────────────

export interface VectorStoreCheckOptions {
  qdrantUrl?: string | undefined;
  qdrantCollection: string;
  vaultPath: string;
  expectedDimensions: number;
  expectedModel: string;
  allowReset: boolean;
}

export async function validateVectorStore(
  opts: VectorStoreCheckOptions,
): Promise<void> {
  if (opts.qdrantUrl) {
    await validateQdrant(
      opts.qdrantUrl,
      opts.qdrantCollection,
      opts.expectedDimensions,
      opts.allowReset,
    );
  } else {
    await validateLocalStore(
      opts.vaultPath,
      opts.expectedDimensions,
      opts.expectedModel,
      opts.allowReset,
    );
  }
}

// ── Qdrant ──────────────────────────────────────────────────────────

async function validateQdrant(
  qdrantUrl: string,
  collectionName: string,
  expectedDimensions: number,
  allowReset: boolean,
): Promise<void> {
  const baseUrl = qdrantUrl.replace(/\/+$/, "");

  let collectionsResponse: Response;
  try {
    collectionsResponse = await fetch(`${baseUrl}/collections`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StartupError(
      `Qdrant is not reachable at ${qdrantUrl}`,
      `Ensure Qdrant is running or unset VECTOR_STORE_URL to use local storage.`,
    );
  }

  if (!collectionsResponse.ok) {
    throw new StartupError(
      `Qdrant returned HTTP ${collectionsResponse.status}`,
      `Check Qdrant health at ${qdrantUrl}.`,
    );
  }

  const collectionsData = (await collectionsResponse.json()) as {
    result?: { collections?: Array<{ name: string }> };
  };
  const collections = collectionsData.result?.collections ?? [];
  const exists = collections.some((c) => c.name === collectionName);

  if (!exists) return;

  let infoResponse: Response;
  try {
    infoResponse = await fetch(
      `${baseUrl}/collections/${encodeURIComponent(collectionName)}`,
      { signal: AbortSignal.timeout(5000) },
    );
  } catch {
    throw new StartupError(
      `Failed to query Qdrant collection "${collectionName}"`,
      `Check Qdrant health at ${qdrantUrl}.`,
    );
  }

  if (!infoResponse.ok) {
    throw new StartupError(
      `Qdrant returned HTTP ${infoResponse.status} for collection "${collectionName}"`,
      `Check Qdrant health at ${qdrantUrl}.`,
    );
  }

  const infoData = (await infoResponse.json()) as {
    result?: {
      config?: { params?: { vectors?: { size?: number } } };
    };
  };
  const storedSize = infoData.result?.config?.params?.vectors?.size;

  if (storedSize === undefined || storedSize === expectedDimensions) return;

  if (allowReset) {
    console.error(
      `[StartupCheck] Qdrant collection "${collectionName}" has dimension ${storedSize} but expected ${expectedDimensions}. Deleting collection (VECTOR_STORE_RESET=true).`,
    );
    const deleteResponse = await fetch(
      `${baseUrl}/collections/${encodeURIComponent(collectionName)}`,
      { method: "DELETE", signal: AbortSignal.timeout(10_000) },
    );
    if (!deleteResponse.ok) {
      throw new StartupError(
        `Failed to delete Qdrant collection "${collectionName}" (HTTP ${deleteResponse.status})`,
        `Manually delete the collection or fix the dimension mismatch.`,
      );
    }
    return;
  }

  throw new StartupError(
    `Qdrant collection "${collectionName}" has vector size ${storedSize} but the current embedding provider produces ${expectedDimensions}-dimensional vectors`,
    `Switch back to the original embedding model, delete the collection manually, or set VECTOR_STORE_RESET=true to auto-rebuild.`,
  );
}

// ── Local persisted store ───────────────────────────────────────────

interface LocalIndexMeta {
  embeddingModel: string;
  dimensions: number;
}

async function validateLocalStore(
  vaultPath: string,
  expectedDimensions: number,
  expectedModel: string,
  allowReset: boolean,
): Promise<void> {
  const storeDir = path.join(vaultPath, ".markdown_vault_mcp");
  const indexFile = path.join(storeDir, "index.json");

  let raw: string;
  try {
    raw = await fs.readFile(indexFile, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw new StartupError(
      `Failed to read local vector index at ${indexFile}: ${err.message}`,
      `Check file permissions or delete the .markdown_vault_mcp directory.`,
    );
  }

  let meta: LocalIndexMeta;
  try {
    meta = JSON.parse(raw) as LocalIndexMeta;
  } catch {
    if (allowReset) {
      console.error(
        `[StartupCheck] Corrupted index at ${indexFile}. Deleting (VECTOR_STORE_RESET=true).`,
      );
      await deleteLocalIndex(storeDir);
      return;
    }
    throw new StartupError(
      `Corrupted vector index at ${indexFile}`,
      `Delete the .markdown_vault_mcp directory or set VECTOR_STORE_RESET=true.`,
    );
  }

  const dimensionMismatch = meta.dimensions !== expectedDimensions;
  const modelMismatch = meta.embeddingModel !== expectedModel;

  if (!dimensionMismatch && !modelMismatch) return;

  if (allowReset) {
    const reason = dimensionMismatch
      ? `dimensions ${meta.dimensions} → ${expectedDimensions}`
      : `model "${meta.embeddingModel}" → "${expectedModel}"`;
    console.error(
      `[StartupCheck] Local index mismatch (${reason}). Deleting (VECTOR_STORE_RESET=true).`,
    );
    await deleteLocalIndex(storeDir);
    return;
  }

  const details: string[] = [];
  if (dimensionMismatch) {
    details.push(
      `dimensions: stored=${meta.dimensions}, current=${expectedDimensions}`,
    );
  }
  if (modelMismatch) {
    details.push(
      `model: stored="${meta.embeddingModel}", current="${expectedModel}"`,
    );
  }

  throw new StartupError(
    `Local vector index is incompatible with current embedding provider (${details.join("; ")})`,
    `Switch back to the original model, delete the .markdown_vault_mcp directory, or set VECTOR_STORE_RESET=true to auto-rebuild.`,
  );
}

async function deleteLocalIndex(storeDir: string): Promise<void> {
  await fs.rm(path.join(storeDir, "index.json"), { force: true });
  await fs.rm(path.join(storeDir, "vectors.bin"), { force: true });
  await fs.rm(path.join(storeDir, "index.json.tmp"), { force: true });
  await fs.rm(path.join(storeDir, "vectors.bin.tmp"), { force: true });
}
