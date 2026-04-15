import { IVectorStore } from "../domain/interfaces/index.js";
import { PersistedFlatVectorStore } from "./vector-store/persisted-flat-vector-store.js";
import { QdrantVectorStore } from "./vector-store/qdrant-vector-store.js";

export async function createVectorStore(
  vaultPath: string,
  embeddingModel: string,
  dimensions: number
): Promise<IVectorStore> {
  const qdrantUrl = process.env.VECTOR_STORE_URL;

  if (qdrantUrl) {
    const collectionName = process.env.VECTOR_STORE_COLLECTION ?? "markdown_vault";
    console.error(`[VectorStore] Using Qdrant at ${qdrantUrl} (collection: ${collectionName})`);
    return new QdrantVectorStore(qdrantUrl, dimensions, collectionName);
  }

  console.error("[VectorStore] Using PersistedFlatVectorStore (local)");
  const store = new PersistedFlatVectorStore(vaultPath, embeddingModel, dimensions);
  await store.load();
  return store;
}
