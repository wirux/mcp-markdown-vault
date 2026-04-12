Action Plan: Implement Native TypeScript Embeddings Fallback
Goal: Introduce @huggingface/transformers as an optional, native embedding provider to remove the strict dependency on Ollama, maintaining the existing Clean Architecture.

Phase 1: Dependencies & Discovery
[x] Install the required dependency: npm install @huggingface/transformers.

[x] Analyze the existing OllamaEmbeddingProvider (in src/infrastructure/ollama-embedding.ts) to understand the exact interface or abstract class it implements (e.g., generateEmbedding(text: string): Promise<number>).

Phase 2: Test-Driven Development (TDD)
[x] Create a test file src/infrastructure/transformers-embedding.test.ts.

[x] Write Vitest unit tests for TransformersEmbeddingProvider. You will need to use vi.mock('@huggingface/transformers') to mock the pipeline and feature-extraction behavior so tests run instantly without downloading models.

Phase 3: Implementation
[x] Create src/infrastructure/transformers-embedding.ts.

[x] Implement the embedding interface. Use the pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') method.

[x] Ensure the output tensor is correctly converted into a flat array of numbers (e.g., using mean pooling and .tolist()).

Phase 4: Integration in index.ts
[x] Modify src/index.ts.

[x] Implement the factory/strategy logic: Check environment variables (e.g., USE_LOCAL_EMBEDDINGS=true or check if OLLAMA_URL is omitted).

[x] Initialize TransformersEmbeddingProvider if the native route is chosen, otherwise fallback to the existing OllamaEmbeddingProvider initialization.

[x] Update README.md to explain the new "Zero-Setup" native embedding feature and how to toggle between native and Ollama modes via environment variables.
