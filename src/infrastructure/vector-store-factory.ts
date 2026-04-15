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
    console.error(`[VectorStore] Using Qdrant at ${qdrantUrl}`);
    return new QdrantVectorStore(qdrantUrl, dimensions);
  }

  console.error("[VectorStore] Using PersistedFlatVectorStore (local)");
  const store = new PersistedFlatVectorStore(vaultPath, embeddingModel, dimensions);
  await store.load();
  return store;
}
