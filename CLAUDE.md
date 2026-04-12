# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Standalone, Dockerized TypeScript MCP (Model Context Protocol) server for Obsidian. Provides headless semantic search, AST-based note editing, and workflow state tracking over Obsidian vaults via the stdio transport.

## Development Commands

```bash
# Install dependencies
npm install

# Build (compiles to dist/, excludes test files)
npx tsc

# Run all tests (228 tests across 18 files)
npx vitest run

# Run a single test file
npx vitest run src/domain/errors/domain-errors.test.ts

# Run tests in watch mode
npx vitest

# Type-check without emitting
npx tsc --noEmit

# Docker
docker compose up --build
```

## Architecture

Clean Architecture with four layers:

- **`src/domain/`** — Domain errors, port interfaces (`IFileSystemAdapter`, `IEmbeddingProvider`, `IVectorStore`), value objects (`SafePath`)
- **`src/use-cases/`** — Business logic: AST parsing/patching, chunking, scoring, retrieval, hybrid search, workflow state, hints, fuzzy matching, wikilink resolution, vault indexing
- **`src/infrastructure/`** — Adapters: `LocalFileSystemAdapter` (fs/promises), `OllamaEmbeddingProvider` (REST), `InMemoryVectorStore` (cosine similarity)
- **`src/presentation/`** — 5 MCP tool bindings via `@modelcontextprotocol/sdk` (`createMcpServer()`)

Entry point: `src/index.ts` — composition root, reads env vars, wires dependencies, connects stdio transport.

### Key Subsystems

- **AST Parser** (`markdown-pipeline.ts`, `ast-navigation.ts`, `ast-patcher.ts`): unified pipeline (remark-parse + remark-gfm + remark-frontmatter) for surgical markdown patching (append/prepend/replace by heading or block ID)
- **Fragment Retrieval** (`chunker.ts`, `scoring.ts`, `fragment-retrieval.ts`): heading-aware markdown chunking with TF-IDF + word proximity scoring
- **Semantic Search** (`hybrid-search.ts`, `vault-indexer.ts`): hybrid search combining vector similarity (Ollama embeddings) with lexical TF-IDF; background auto-vectorization via chokidar file watcher with debounce
- **Workflow** (`workflow-state.ts`, `hints.ts`): Petri net state machine (IDLE → EXPLORING → EDITING → REVIEWING); contextual hints appended to all tool responses
- **Fuzzy Matching** (`fuzzy-match.ts`): Levenshtein-based typo resilience for edit operations
- **5 MCP Tools**: vault (CRUD), edit (AST patching), view (fragment retrieval + outline), workflow (state transitions), system (status)

### Security

All file operations route through `SafePath` value object — prevents path traversal (`../`, encoded variants, backslash, null bytes). `LocalFileSystemAdapter` uses atomic writes (temp file + rename).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `/vault` | Obsidian vault directory |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama REST API base URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Embedding model name |
| `OLLAMA_DIMENSIONS` | `768` | Embedding vector dimensions |

## Conventions

### Layer Dependencies (strictly enforced)

- **Domain** → no imports from other layers
- **Use Cases** → may import domain only
- **Infrastructure** → may import domain only
- **Presentation** → may import all layers (composition root)

### TypeScript

- ESM (`"type": "module"`) — use `node:` prefix for Node built-ins (e.g. `node:fs/promises`, `node:path`)
- Strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`
- Explicit types at module boundaries; infer internally

### Error Handling

- Throw domain-specific errors (subclasses of `DomainError` in `src/domain/errors/index.ts`) with machine-readable `code` fields
- Catch and wrap infrastructure errors into domain errors at the adapter boundary

### Testing

- Co-located test files: `module.ts` → `module.test.ts` in the same directory
- Use real temp directories for file system tests — no mocks
- Use `InMemoryTransport` from `@modelcontextprotocol/sdk` for MCP integration tests
- All file paths in tests must go through `SafePath`
