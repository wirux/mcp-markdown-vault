import { describe, it, expect, vi, beforeEach } from "vitest";
import { QdrantVectorStore, QdrantVectorStoreError } from "./qdrant-vector-store.js";
import { QdrantClient } from "@qdrant/js-client-rest";

const mockGetCollections = vi.fn();
const mockGetCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockUpsert = vi.fn();
const mockSearch = vi.fn();
const mockDelete = vi.fn();
const mockScroll = vi.fn();

vi.mock("@qdrant/js-client-rest", () => {
  return {
    QdrantClient: class {
      getCollections = mockGetCollections;
      getCollection = mockGetCollection;
      createCollection = mockCreateCollection;
      upsert = mockUpsert;
      search = mockSearch;
      delete = mockDelete;
      scroll = mockScroll;
    }
  };
});

describe("QdrantVectorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockGetCollection.mockResolvedValue({ points_count: 0, config: { params: { vectors: { size: 128 } } } });
    mockCreateCollection.mockResolvedValue({});
    mockUpsert.mockResolvedValue({});
    mockSearch.mockResolvedValue([]);
    mockDelete.mockResolvedValue({});
    mockScroll.mockResolvedValue({ points: [] });
  });

  it("Constructor calls recreateCollection when collection does not exist", async () => {
    const store = new QdrantVectorStore("http://localhost:6333", 128);
    await store.size(); // trigger init
    
    expect(mockGetCollections).toHaveBeenCalled();
    expect(mockCreateCollection).toHaveBeenCalledWith("markdown_vault", {
      vectors: { size: 128, distance: "Cosine" },
      on_disk_payload: true,
    });
  });

  it("Constructor does NOT recreate if collection exists with matching vector size", async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: "markdown_vault" }] });
    mockGetCollection.mockResolvedValue({
      config: { params: { vectors: { size: 128 } } }
    });

    const store = new QdrantVectorStore("http://localhost:6333", 128);
    await store.size();

    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it("Constructor throws DomainError if collection exists with wrong vector size", async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: "markdown_vault" }] });
    mockGetCollection.mockResolvedValue({
      config: { params: { vectors: { size: 256 } } }
    });

    const store = new QdrantVectorStore("http://localhost:6333", 128);

    await expect(store.size()).rejects.toThrow(QdrantVectorStoreError);
  });

  it("Transient init failure allows retry on next call", async () => {
    mockGetCollections
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ collections: [] });
    mockCreateCollection.mockResolvedValue({});

    const store = new QdrantVectorStore("http://localhost:6333", 128);

    await expect(store.size()).rejects.toThrow(QdrantVectorStoreError);
    // Second call retries initialization instead of returning cached rejection
    const size = await store.size();
    expect(size).toBe(0);
    expect(mockGetCollections).toHaveBeenCalledTimes(2);
  });

  it("upsert maps VectorEntry to correct Qdrant point shape", async () => {
    const store = new QdrantVectorStore("http://localhost:6333", 128);
    await store.upsert({
      docPath: "file1.md",
      chunks: [
        {
          chunkId: "c1",
          vector: [1, 0],
          text: "hello",
          headingPath: ["h1"],
        }
      ]
    });

    expect(mockDelete).toHaveBeenCalledWith("markdown_vault", {
      wait: true,
      filter: { must: [{ key: "docPath", match: { value: "file1.md" } }] }
    });

    expect(mockUpsert).toHaveBeenCalledWith("markdown_vault", {
      wait: true,
      points: [
        expect.objectContaining({
          id: expect.any(String),
          vector: [1, 0],
          payload: {
            docPath: "file1.md",
            chunkId: "c1",
            text: "hello",
            headingPath: ["h1"],
          }
        })
      ]
    });
  });

  it("delete sends correct payload filter for filePath", async () => {
    const store = new QdrantVectorStore("http://localhost:6333", 128);
    await store.delete("file1.md");

    expect(mockDelete).toHaveBeenCalledWith("markdown_vault", {
      wait: true,
      filter: { must: [{ key: "docPath", match: { value: "file1.md" } }] }
    });
  });

  it("search maps Qdrant response to VectorSearchResult[] with correct score ordering", async () => {
    mockSearch.mockResolvedValue([
      {
        score: 0.9,
        payload: { docPath: "f1.md", chunkId: "c1", text: "t1", headingPath: ["h1"] }
      },
      {
        score: 0.8,
        payload: { docPath: "f2.md", chunkId: "c2", text: "t2", headingPath: ["h2"] }
      }
    ]);

    const store = new QdrantVectorStore("http://localhost:6333", 128);
    const results = await store.search([1, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.docPath).toBe("f1.md");
    expect(results[0]?.similarity).toBe(0.9);
    expect(results[1]?.docPath).toBe("f2.md");
    expect(results[1]?.similarity).toBe(0.8);
  });

  it("Network error from Qdrant client is wrapped into a DomainError", async () => {
    mockSearch.mockRejectedValue(new Error("Network timeout"));

    const store = new QdrantVectorStore("http://localhost:6333", 128);
    await expect(store.search([1, 0], 2)).rejects.toThrow(QdrantVectorStoreError);
  });
});
