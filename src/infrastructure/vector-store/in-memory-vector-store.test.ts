import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVectorStore } from "./in-memory-vector-store.js";
import type { VectorEntry } from "../domain/interfaces/index.js";

let store: InMemoryVectorStore;

beforeEach(() => {
  store = new InMemoryVectorStore();
});

// Helper: normalised unit vectors for predictable cosine similarity
function unitVec(...components: number[]): number[] {
  const mag = Math.sqrt(components.reduce((s, v) => s + v * v, 0));
  return components.map((v) => v / mag);
}

const DOC_A: VectorEntry = {
  docPath: "notes/a.md",
  chunks: [
    {
      chunkId: "a-intro",
      vector: unitVec(1, 0, 0),
      text: "Introduction to topic A",
      headingPath: ["A", "Intro"],
    },
    {
      chunkId: "a-details",
      vector: unitVec(0.9, 0.1, 0),
      text: "Details about topic A",
      headingPath: ["A", "Details"],
    },
  ],
};

const DOC_B: VectorEntry = {
  docPath: "notes/b.md",
  chunks: [
    {
      chunkId: "b-intro",
      vector: unitVec(0, 1, 0),
      text: "Introduction to topic B",
      headingPath: ["B", "Intro"],
    },
  ],
};

const DOC_C: VectorEntry = {
  docPath: "notes/c.md",
  chunks: [
    {
      chunkId: "c-intro",
      vector: unitVec(0, 0, 1),
      text: "Introduction to topic C",
      headingPath: ["C", "Intro"],
    },
  ],
};

describe("InMemoryVectorStore", () => {
  describe("upsert", () => {
    it("adds document chunks to the store", async () => {
      await store.upsert(DOC_A);
      expect(await store.size()).toBe(1);
      expect(await store.has("notes/a.md")).toBe(true);
    });

    it("replaces existing document on re-upsert", async () => {
      await store.upsert(DOC_A);
      const updated: VectorEntry = {
        docPath: "notes/a.md",
        chunks: [
          {
            chunkId: "a-new",
            vector: unitVec(0.5, 0.5, 0),
            text: "Replaced content",
            headingPath: ["A"],
          },
        ],
      };
      await store.upsert(updated);
      expect(await store.size()).toBe(1);

      // Searching should find the new content
      const results = await store.search(unitVec(0.5, 0.5, 0), 1);
      expect(results[0]!.text).toBe("Replaced content");
    });
  });

  describe("search", () => {
    it("returns the most similar chunk", async () => {
      await store.upsert(DOC_A);
      await store.upsert(DOC_B);
      await store.upsert(DOC_C);

      // Query close to DOC_A's first chunk
      const results = await store.search(unitVec(1, 0, 0), 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.chunkId).toBe("a-intro");
      expect(results[0]!.similarity).toBeCloseTo(1, 5);
    });

    it("ranks results by descending similarity", async () => {
      await store.upsert(DOC_A);
      await store.upsert(DOC_B);
      await store.upsert(DOC_C);

      const results = await store.search(unitVec(0.7, 0.7, 0), 5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.similarity).toBeLessThanOrEqual(
          results[i - 1]!.similarity,
        );
      }
    });

    it("respects the k limit", async () => {
      await store.upsert(DOC_A); // 2 chunks
      await store.upsert(DOC_B); // 1 chunk
      await store.upsert(DOC_C); // 1 chunk — total 4

      const results = await store.search(unitVec(1, 0, 0), 2);
      expect(results).toHaveLength(2);
    });

    it("returns empty array when store is empty", async () => {
      const results = await store.search(unitVec(1, 0, 0), 5);
      expect(results).toEqual([]);
    });

    it("includes correct metadata in results", async () => {
      await store.upsert(DOC_B);
      const results = await store.search(unitVec(0, 1, 0), 1);
      expect(results[0]!.docPath).toBe("notes/b.md");
      expect(results[0]!.chunkId).toBe("b-intro");
      expect(results[0]!.text).toBe("Introduction to topic B");
      expect(results[0]!.headingPath).toEqual(["B", "Intro"]);
    });
  });

  describe("delete", () => {
    it("removes all chunks for a document", async () => {
      await store.upsert(DOC_A);
      await store.upsert(DOC_B);
      await store.delete("notes/a.md");

      expect(await store.has("notes/a.md")).toBe(false);
      expect(await store.size()).toBe(1);

      // Search should not return DOC_A chunks
      const results = await store.search(unitVec(1, 0, 0), 5);
      expect(results.every((r) => r.docPath !== "notes/a.md")).toBe(true);
    });

    it("is a no-op for non-existent document", async () => {
      await store.delete("nope.md"); // should not throw
      expect(await store.size()).toBe(0);
    });
  });

  describe("has", () => {
    it("returns false for un-indexed document", async () => {
      expect(await store.has("nope.md")).toBe(false);
    });
  });

  describe("cosine similarity correctness", () => {
    it("identical vectors → similarity 1", async () => {
      await store.upsert({
        docPath: "x.md",
        chunks: [
          {
            chunkId: "x",
            vector: [1, 2, 3],
            text: "x",
            headingPath: [],
          },
        ],
      });
      const results = await store.search([1, 2, 3], 1);
      expect(results[0]!.similarity).toBeCloseTo(1, 5);
    });

    it("orthogonal vectors → similarity 0", async () => {
      await store.upsert({
        docPath: "x.md",
        chunks: [
          {
            chunkId: "x",
            vector: [1, 0, 0],
            text: "x",
            headingPath: [],
          },
        ],
      });
      const results = await store.search([0, 1, 0], 1);
      expect(results[0]!.similarity).toBeCloseTo(0, 5);
    });
  });
});
