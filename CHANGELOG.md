# Changelog

All notable changes to the Obsidian Semantic MCP Server are documented here.

---

## Phase 1 — Project & Architecture Setup (TDD)

### Added
- Initialized Node.js/TypeScript project with ESM (`"type": "module"`)
- `tsconfig.json` with `strict: true` plus additional strictness flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.)
- Vitest test framework configured (`vitest.config.ts`)
- Clean Architecture folder structure: `src/domain/`, `src/use-cases/`, `src/infrastructure/`, `src/presentation/`
- `DomainError` base class with machine-readable `code`, human-readable `message`, and optional `cause`
- 11 specific domain error classes:
  - File system: `VaultNotFoundError`, `PathTraversalError`, `NoteNotFoundError`, `NoteAlreadyExistsError`, `InvalidNotePathError`
  - AST: `AstPatchError`, `HeadingNotFoundError`, `BlockNotFoundError`
  - Embedding: `EmbeddingError`, `VectorDbError`
  - Workflow: `StateTransitionError`
- 15 unit tests covering all domain errors (TDD: RED → GREEN)
- `.gitignore` for `node_modules/`, `dist/`, `coverage/`
- `CLAUDE.md` project guidance file

---

## Phase 2 — File System & Security (Headless Foundation)

### Added
- `IFileSystemAdapter` port interface (`src/domain/interfaces/file-system-adapter.ts`)
  - Methods: `listNotes`, `readNote`, `writeNote`, `deleteNote`, `exists`, `stat`
  - `NoteStat` type with `sizeBytes` and `modifiedAt` fields
- `SafePath` value object (`src/domain/value-objects/safe-path.ts`)
  - Immutable, validated vault-relative path
  - `SafePath.create()` for note files (auto-appends `.md`)
  - `SafePath.createDirectory()` for directory paths
  - Security: rejects `../` traversal, encoded variants (`%2e%2e`), double-encoded (`%252e`), backslash traversal, null bytes, empty/whitespace paths
  - Iterative URL-decoding to defeat multi-layer encoding attacks
- `LocalFileSystemAdapter` (`src/infrastructure/local-fs-adapter.ts`)
  - Async factory `LocalFileSystemAdapter.create(vaultRoot)` with vault existence validation
  - Atomic writes via temp file + `fs.rename`
  - Recursive `.md` file listing with alphabetical sort
  - Auto-creates parent directories on write
  - All operations route through `SafePath` for traversal protection
- 20 unit tests for `SafePath` (path normalization + security boundaries)
- 23 integration tests for `LocalFileSystemAdapter` (real temp directories, no mocks)

### Test Results
- **58 tests across 3 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 3 — AST Parser & Surgical Patching

### Added
- `MarkdownPipeline` (`src/use-cases/markdown-pipeline.ts`)
  - Unified pipeline configured with `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-stringify`
  - Lossless `parse()` → `stringify()` round-trip for GFM tables, task lists, YAML frontmatter
- `AstNavigator` (`src/use-cases/ast-navigation.ts`)
  - `findHeading(tree, title, depth)` — case-insensitive heading lookup
  - `getHeadingRange(tree, title, depth)` — returns `[startIndex, endIndex)` slice of children owned by a heading section (stops at next same-or-higher-level heading)
  - `findBlockById(tree, blockId)` — locates paragraph ending with `^block-id`
  - `findAllHeadings(tree)` — lists all headings with depth and index
  - `getHeadingText(heading)` — extracts plain text from heading node (recursing through inline formatting)
- `AstPatcher` (`src/use-cases/ast-patcher.ts`)
  - Three operations: `append`, `prepend`, `replace`
  - Three target types: heading (by title + depth), block ID (`^id`), document-level
  - Heading append inserts before next same-level heading boundary
  - Heading replace removes body but preserves the heading itself
  - Document prepend inserts after YAML frontmatter when present
  - Throws `HeadingNotFoundError` / `BlockNotFoundError` for invalid targets
  - **Critical test verified**: appending under H2 does NOT corrupt subsequent H3
- `WikilinkResolver` (`src/use-cases/wikilink-resolver.ts`)
  - Shortest-path algorithm: fewest path segments wins, alphabetical tiebreaker
  - Partial path matching (`[[folder/note]]`)
  - Handles anchors (`#heading`, `#^block`), `.md` extension, `[[link|alias]]` syntax
  - `extractWikilinks(markdown)` — regex extraction of all `[[targets]]` from raw text
- 6 pipeline round-trip tests
- 11 AST navigator tests
- 11 AST patcher tests (including PLAN.md critical H2/H3 integrity test)
- 13 wikilink resolver tests

### Dependencies Added
- `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`, `remark-frontmatter`
- `@types/mdast` (dev)

### Test Results
- **99 tests across 7 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 4 — Fragment Retrieval Engine

### Added
- `MarkdownChunker` (`src/use-cases/chunker.ts`)
  - Splits markdown at heading boundaries into `Chunk` objects
  - Preserves heading hierarchy as breadcrumb `headingPath` (e.g. `["Root", "Section", "Sub"]`)
  - Includes heading text in chunk body for keyword scoring
  - Tracks `startLine`, `endLine`, `wordCount` metadata per chunk
  - Excludes YAML frontmatter from chunk text
  - Resets heading stack correctly when a higher-level heading appears
- `TfIdfScorer` (`src/use-cases/scoring.ts`)
  - Classic TF-IDF: TF = term count / chunk length, IDF = ln(N / df)
  - Multi-word queries: sums per-term TF-IDF
  - Case-insensitive tokenisation with punctuation stripping
- `ProximityScorer` (`src/use-cases/scoring.ts`)
  - Scores by inverse average minimum pairwise distance between consecutive query terms
  - Returns 0 for single-word queries (proximity is meaningless)
  - Uses best occurrence pair when words repeat
- `FragmentRetriever` (`src/use-cases/fragment-retrieval.ts`)
  - Composes chunking → TF-IDF → proximity → normalised weighted combination
  - Configurable: `maxChunks`, `minScore` threshold, `tfidfWeight` (default 0.7)
  - Filters zero-score chunks, sorts by combined score descending
  - **PLAN.md critical test verified**: retrieves only the relevant ~500-word quantum computing chunk from a 10,000+ word document, correctly ignoring 19 filler sections
- 11 chunker tests (splitting, hierarchy, frontmatter, metadata, edge cases)
- 10 scoring tests (TF-IDF ranking, IDF rarity, case-insensitivity, proximity adjacency)
- 8 fragment retrieval tests (relevance, ranking, maxChunks, 10K-word document)

### Test Results
- **128 tests across 10 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 5 — Semantic Search & Vector Database

### Added
- `IEmbeddingProvider` interface (`src/domain/interfaces/embedding-provider.ts`)
  - `embed(text)`, `embedBatch(texts)`, `dimensions` property
- `IVectorStore` interface (`src/domain/interfaces/vector-store.ts`)
  - `upsert`, `search`, `delete`, `has`, `size`
  - `VectorEntry`, `VectorChunk`, `VectorSearchResult` types
- `OllamaEmbeddingProvider` (`src/infrastructure/ollama-embedding.ts`)
  - Wraps Ollama `/api/embed` REST endpoint
  - Throws `EmbeddingError` on HTTP or network failure
- `InMemoryVectorStore` (`src/infrastructure/in-memory-vector-store.ts`)
  - Brute-force cosine similarity search
  - Full `IVectorStore` implementation (upsert replaces, delete removes all chunks)
  - Suitable for small-to-medium vaults and testing
- `VaultIndexer` (`src/use-cases/vault-indexer.ts`)
  - `indexFile` — chunks a note, embeds each chunk, upserts into vector store
  - `removeFile` — deletes a note's vectors
  - `indexAll` — bulk indexes all `.md` files recursively
  - Offline queue with deduplication (`enqueue` / `processQueue`)
  - Live file watcher via chokidar with configurable debounce
  - `awaitWriteFinish` for write stability, ignores non-`.md` files
- `HybridSearcher` (`src/use-cases/hybrid-search.ts`)
  - Embeds query, searches vector store for broad candidates (3x k)
  - Re-scores candidates with TF-IDF for lexical signal
  - Normalises both score sets to [0, 1], combines with weighted sum
  - Configurable `vectorWeight` (default 0.6) and `k`
  - Returns `vectorScore` and `lexicalScore` per result for transparency
  - **PLAN.md semantic test verified**: retrieves correct content using abstract queries with no keyword overlap (e.g. "nebula" → astronomy doc)
- 7 Ollama embedding tests (request format, error handling, batch)
- 12 vector store tests (upsert, search ranking, delete, cosine correctness)
- 10 vault indexer tests (index, remove, bulk, queue, watcher)
- 9 hybrid search tests (vector-dominant, hybrid boosting, semantic retrieval, weight tuning)

### Dependencies Added
- `chokidar` — file system watcher

### Test Results
- **166 tests across 14 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 6 — State Tracking & MCP Tool Consolidation

### Added
- `WorkflowStateMachine` (`src/use-cases/workflow-state.ts`)
  - Petri net–inspired state machine with 4 places: IDLE → EXPLORING → EDITING → REVIEWING
  - 10 transitions: search, open_note, refine, reset, save, back, done
  - `fire(transition)` with `StateTransitionError` for invalid moves
  - `availableTransitions()`, `getHistory()`, `hardReset()`
  - Full transition history with timestamps
- `HintsEngine` (`src/use-cases/hints.ts`)
  - State-based next-action hints for each workflow place
  - Tool-specific hints for all 5 tools × 4 states (20 hint sets)
  - `formatResponse()` — wraps any tool result with contextual hints, available transitions, and current state
- `FuzzyMatcher` (`src/use-cases/fuzzy-match.ts`)
  - Levenshtein distance (Wagner–Fischer DP algorithm)
  - Similarity score = 1 - (distance / maxLength)
  - `bestMatch()` with configurable threshold (default 0.6)
  - `allMatches()` returning sorted candidates above threshold
  - Handles typos, transpositions, missing/extra characters
- `createMcpServer()` (`src/presentation/mcp-tools.ts`)
  - 5 semantic MCP tools bound via `@modelcontextprotocol/sdk`:
    - **vault**: list, read, create, delete, stat
    - **edit**: append/prepend/replace targeting headings (with fuzzy matching), block IDs, or document-level
    - **view**: fragment retrieval with query, heading outline, full read
    - **workflow**: status, fire transitions, history, reset
    - **system**: status (vault root, indexed doc count, workflow state)
  - All responses enriched with contextual hints via `HintsEngine.formatResponse()`
  - Domain errors caught and returned as `isError: true` with error codes
  - Zod input validation via MCP SDK `registerTool`
- `src/index.ts` — main entry point
  - Reads config from env vars: `VAULT_PATH`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_DIMENSIONS`
  - Wires all dependencies (Clean Architecture composition root)
  - Starts background vault indexing + chokidar file watcher
  - Connects via stdio transport
  - Graceful SIGINT shutdown
- 19 workflow state machine tests (transitions, invalid moves, history, reset)
- 11 hints engine tests (state-based hints, tool hints, response formatting)
- 17 fuzzy matcher tests (exact, case-insensitive, typos, threshold, Levenshtein)
- 15 MCP integration tests (tool listing, vault CRUD, edit patching, view search, workflow transitions, system status — all via in-memory MCP transport)

### Dependencies Added
- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` (transitive via SDK)

### Test Results
- **228 tests across 18 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 7 — Dockerization

### Added
- `Dockerfile` — multi-stage build
  - **Stage 1 (builder)**: `node:22-alpine`, `npm ci`, `tsc` compile, prune dev deps
  - **Stage 2 (production)**: `node:22-alpine`, copies only `dist/` + production `node_modules`
  - Non-root `mcp` user for security
  - `/vault` mount point pre-created with correct ownership
  - Environment defaults: `VAULT_PATH=/vault`, `OLLAMA_URL=http://host.docker.internal:11434`, `OLLAMA_MODEL=nomic-embed-text`, `OLLAMA_DIMENSIONS=768`
  - `ENTRYPOINT ["node", "dist/index.js"]`
- `docker-compose.yml`
  - Vault volume mapping: `./my-vault:/vault:rw`
  - `host.docker.internal` extra host for Ollama connectivity
  - `stdin_open: true` for stdio MCP transport
- `.dockerignore` — excludes `node_modules`, `dist`, `.git`, markdown files (except `package.json`)
- `tsconfig.json` updated to exclude `*.test.ts` from build output

### Final Project Stats
- **228 tests across 18 files — all passing**
- Clean TypeScript compilation with strict mode
- All 7 phases from PLAN.md completed

---

## Phase 8 — Zero-Setup Local Embeddings

### Added
- `TransformersEmbeddingProvider` (`src/infrastructure/transformers-embedding.ts`)
  - Implements `IEmbeddingProvider` using `@huggingface/transformers`
  - Uses `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` for 384-dimensional embeddings
  - Lazy model loading — downloaded on first use, cached locally
  - Mean pooling + L2 normalization via pipeline options
  - Wraps load/inference errors into `EmbeddingError`
- Embedding provider strategy in `src/index.ts`
  - If `OLLAMA_URL` is explicitly set and Ollama is reachable → use Ollama
  - If `OLLAMA_URL` is not set → use local `TransformersEmbeddingProvider` (zero-setup)
  - If `OLLAMA_URL` is set but unreachable → fall back to local with warning
  - Reachability check via `/api/tags` with 3-second timeout
- 11 unit tests for `TransformersEmbeddingProvider` (lazy loading, reuse, error wrapping, batch, custom model)

### Dependencies Added
- `@huggingface/transformers` — in-process ONNX model inference

### Test Results
- **239 tests across 19 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 9 — Dual Transport (Stdio & SSE)

### Added
- `TransportType`, `parseTransportType()`, `createSseApp()`, `startTransport()` (`src/presentation/transport.ts`)
  - `parseTransportType` validates `MCP_TRANSPORT_TYPE` env var (`stdio` | `sse`)
  - `createSseApp` creates an Express app with CORS, `GET /sse` (SSE stream), and `POST /messages` (JSON-RPC routing by sessionId)
  - `startTransport` orchestrates either stdio or SSE startup and returns a `TransportHandle` for graceful shutdown
  - Each SSE client gets its own `McpServer` + `WorkflowStateMachine` via server factory pattern
  - Shared dependencies (fsAdapter, vectorStore, embedder) are reused across connections
- Updated `src/index.ts` composition root
  - Server factory pattern: creates per-connection McpServer with shared deps + fresh WorkflowStateMachine
  - `MCP_TRANSPORT_TYPE` and `PORT` env vars
  - Graceful shutdown closes HTTP server and all active SSE sessions
- 10 unit tests for transport layer (parseTransportType validation, SSE Express routes, session lifecycle, CORS, multi-client isolation)

### Configuration Matrix (all 4 combinations supported)
| Transport | Embeddings | Status |
|---|---|---|
| stdio + Local (Transformers.js) | Default, zero-setup | Supported |
| stdio + Ollama | Set `OLLAMA_URL` | Supported |
| sse + Local (Transformers.js) | Set `MCP_TRANSPORT_TYPE=sse` | Supported |
| sse + Ollama | Set both `MCP_TRANSPORT_TYPE=sse` and `OLLAMA_URL` | Supported |

### Dependencies Added
- `express` — HTTP server for SSE transport
- `cors` — CORS middleware
- `@types/express`, `@types/cors` (dev)

### Test Results
- **249 tests across 20 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 10 — Global Search & Freeform Editing

### Added
- `VaultSearcher` (`src/use-cases/vault-search.ts`)
  - Cross-vault keyword search using `FragmentRetriever` with TF-IDF + proximity scoring
  - Iterates all vault notes, chunks each, scores against query, returns top results ranked globally
  - Configurable `maxResults` (default 20)
  - Gracefully skips unreadable files
- `FreeformEditor` (`src/use-cases/freeform-editor.ts`)
  - `lineReplace(source, startLine, endLine, content)` — replaces a range of lines (1-based, inclusive)
  - `stringReplace(source, search, replace, replaceAll?)` — literal string find/replace (no regex)
  - Throws `FreeformEditError` for invalid line ranges or missing search strings
- `FreeformEditError` domain error (`src/domain/errors/index.ts`)
- **view tool** — 2 new actions:
  - `global_search` — cross-vault keyword search via `VaultSearcher`
  - `semantic_search` — cross-vault hybrid vector+lexical search via `HybridSearcher`
- **edit tool** — 2 new operations:
  - `line_replace` — replace lines by range (requires `startLine`, `endLine`)
  - `string_replace` — literal string replacement (requires `searchText`, optional `replaceAll`)
- 8 unit tests for `VaultSearcher` (cross-file ranking, headingPath, keyword matching, maxResults, empty vault, flat content, unreadable files)
- 12 unit tests for `FreeformEditor` (single/range line replace, multi-line insert, error cases, first/all string replace, multi-line search, whitespace, regex chars)
- 8 MCP integration tests for new actions/operations (global_search, semantic_search, line_replace, string_replace, error cases)

### Test Results
- **277 tests across 22 files — all passing**
- Clean TypeScript compilation with strict mode

---

## Phase 11 — CI/CD & Semantic Release Pipeline

### Added
- **Semantic Release** (`.releaserc.json`)
  - Automated versioning via [Conventional Commits](https://www.conventionalcommits.org/)
  - Plugin chain: commit-analyzer → release-notes-generator → npm → github → git
  - Publishes scoped package [`@wirux/mcp-obsidian`](https://www.npmjs.com/package/@wirux/mcp-obsidian) to NPM
  - Creates GitHub Releases with auto-generated notes
  - Commits version-bumped `package.json` + `package-lock.json` back with `[skip ci]`
- **Release workflow** (`.github/workflows/release.yml`)
  - Triggered on push to `main`
  - **Job A (ci):** lint + test gate
  - **Job B (release):** builds TypeScript, runs semantic-release (NPM publish + GitHub Release)
  - **Job C (docker):** builds and pushes multi-arch Docker image (`linux/amd64` + `linux/arm64`) to `ghcr.io/wirux/mcp-obsidian` — only runs when a new version is published
  - QEMU emulation for ARM64 cross-compilation
  - GHA layer caching for Docker builds
- **PR Check workflow** (`.github/workflows/pr-check.yml`)
  - Triggered on pull requests to `main`
  - **Job 1 (test-and-verify):** lint → build → test (277 tests)
  - **Job 2 (docker-dry-run):** multi-arch Docker build with `push: false` to validate Dockerfile
- **Package updates** (`package.json`)
  - Scoped package name: `@wirux/mcp-obsidian`
  - Added `bin`, `files`, `publishConfig` for NPM distribution
  - Added `lint` script (`tsc --noEmit`)
  - Semantic release dev dependencies
- **Docker Compose** updated to use pre-built image `ghcr.io/wirux/mcp-obsidian:latest` instead of local build

### Dependencies Added (dev)
- `semantic-release`, `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/npm`, `@semantic-release/github`, `@semantic-release/git`

### Distribution
- **NPM:** `npm install -g @wirux/mcp-obsidian` or `npx -y @wirux/mcp-obsidian`
- **Docker:** `docker pull ghcr.io/wirux/mcp-obsidian:latest` (multi-arch: amd64 + arm64)
