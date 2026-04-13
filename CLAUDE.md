# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Headless, Dockerized TypeScript MCP (Model Context Protocol) server for markdown-based knowledge bases (Obsidian, Logseq, Dendron, Foam, or any folder of `.md` files). Provides semantic search, AST-based note editing, and workflow state tracking via stdio or SSE transport.

## Development Commands

```bash
# Install dependencies
npm install

# Build (compiles to dist/, excludes test files)
npm run build

# Run all tests (296 tests across 25 files)
npm test

# Run a single test file
npx vitest run src/domain/errors/domain-errors.test.ts

# Run tests in watch mode
npm run test:watch

# Lint (type-check without emitting)
npm run lint

# Docker (uses pre-built image from ghcr.io)
docker compose up
```

## Architecture

Clean Architecture with four layers:

- **`src/domain/`** — Domain errors, port interfaces (`IFileSystemAdapter`, `IEmbeddingProvider`, `IVectorStore`, `IMarkdownRepository`), value objects (`SafePath`)
- **`src/use-cases/`** — Business logic: AST parsing/patching, chunking, scoring, retrieval, hybrid search, read-by-heading, frontmatter management, workflow state, hints, fuzzy matching, wikilink resolution, vault indexing
- **`src/infrastructure/`** — Adapters: `LocalFileSystemAdapter` (fs/promises), `OllamaEmbeddingProvider` (REST), `TransformersEmbeddingProvider` (local `@huggingface/transformers`), `InMemoryVectorStore` (cosine similarity), `MarkdownFileRepository` (AST + frontmatter from file)
- **`src/presentation/`** — 5 MCP tool bindings (`createMcpServer()`), transport layer (`transport.ts`: stdio/SSE selection, Express SSE app)

Entry point: `src/index.ts` — composition root, reads env vars, wires dependencies, selects transport.

### Key Subsystems

- **AST Parser** (`markdown-pipeline.ts`, `ast-navigation.ts`, `ast-patcher.ts`): unified pipeline (remark-parse + remark-gfm + remark-frontmatter) for surgical markdown patching (append/prepend/replace by heading or block ID)
- **Fragment Retrieval** (`chunker.ts`, `scoring.ts`, `fragment-retrieval.ts`): heading-aware markdown chunking with TF-IDF + word proximity scoring
- **Semantic Search** (`hybrid-search.ts`, `vault-indexer.ts`): hybrid search combining vector similarity with lexical TF-IDF; background auto-vectorization via chokidar file watcher with debounce
- **Embedding Strategy** (`index.ts`): auto-selects provider — local `TransformersEmbeddingProvider` (zero-setup) or `OllamaEmbeddingProvider` when `OLLAMA_URL` is set and reachable
- **Workflow** (`workflow-state.ts`, `hints.ts`): Petri net state machine (IDLE → EXPLORING → EDITING → REVIEWING); contextual hints appended to all tool responses
- **Fuzzy Matching** (`fuzzy-match.ts`): Levenshtein-based typo resilience for edit operations
- **Transport** (`transport.ts`): dual transport — stdio (default, single client) or SSE over HTTP (multi-client); each SSE connection gets its own McpServer + WorkflowStateMachine while sharing fs/vector/embedder deps
- **Vault Search** (`vault-search.ts`): cross-vault lexical keyword search using FragmentRetriever — no embeddings required
- **Freeform Editor** (`freeform-editor.ts`): line-range replacement and literal string find/replace as fallback for non-AST content
- **Read by Heading** (`read-by-heading.ts`): AST-based section extraction — reads content under a specific heading (up to next same-or-higher-level heading) to save context window space
- **Frontmatter Management** (`frontmatter.ts`): safe read/update of YAML frontmatter via AST + `js-yaml` — merge fields without touching markdown body; `InvalidFrontmatterPayloadError` for malformed JSON input
- **5 MCP Tools**: vault (CRUD), edit (AST patching + freeform line_replace/string_replace + frontmatter_set), view (fragment retrieval + global_search + semantic_search + outline + read by heading + frontmatter_get), workflow (state transitions), system (status)

### Security

All file operations route through `SafePath` value object — prevents path traversal (`../`, encoded variants, backslash, null bytes). `LocalFileSystemAdapter` uses atomic writes (temp file + rename).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `/vault` | Markdown vault directory |
| `MCP_TRANSPORT_TYPE` | `stdio` | Transport: `stdio` (single client) or `sse` (multi-client HTTP) |
| `PORT` | `3000` | HTTP port (SSE mode only) |
| `OLLAMA_URL` | *(unset)* | Set to enable Ollama embeddings; if unset, local embeddings are used |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model name |
| `OLLAMA_DIMENSIONS` | `768` | Ollama embedding vector dimensions |

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

### CI/CD & Release

- **Semantic Release** via `.releaserc.json` — version bumps from [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` = minor, `fix:` = patch, `feat!:` = major)
- **NPM:** published as `@wirux/mcp-markdown-vault` (scoped, public)
- **Docker:** multi-arch images (`linux/amd64` + `linux/arm64`) pushed to `ghcr.io/wirux/mcp-markdown-vault`
- **PR Check** (`.github/workflows/pr-check.yml`): lint → build → test → Docker dry run on every PR to `main`
- **Release** (`.github/workflows/release.yml`): lint → test → semantic-release → Docker build & push on push to `main`
- `docker-compose.yml` uses the pre-built `ghcr.io/wirux/mcp-markdown-vault:latest` image (not local build)
