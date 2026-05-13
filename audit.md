# Audit Report — mcp-markdown-vault

This document captures a planning-ready audit of the `mcp-markdown-vault` repository. It is intended to serve as the baseline for remediation planning, security hardening, and architectural improvements.

## Scope

This audit covers:

- testing strategy and current coverage shape
- Clean Architecture and separation of concerns
- security, especially path safety and MCP/SSE exposure
- performance and scaling considerations
- roadmap and phased remediation planning

## Method

The findings in this document are based on:

- direct source inspection of core files
- inspection of existing tests and documentation
- external MCP/security/performance guidance gathered during review

### Important verification note

I attempted to capture fresh `npm test`, `npm run lint`, and `npm run build` output during the audit session, but the environment wrapped those commands and did not return the raw results. So this report is **source-audit based**, not freshly command-verified.

---

## Executive Summary

This is a strong codebase with real architectural discipline. The project already shows thoughtful layering, good use of ports and adapters, strong AST-based editing design, and better-than-average automated coverage for an MCP server.

The main issues are not general code quality problems. They are concentrated at a few boundaries:

1. **Critical** — filesystem containment is lexical, not canonical; symlink escape protection is missing
2. **High** — SSE transport is too permissive for an HTTP-exposed local service
3. **High** — `VaultIndexer.startWatching()` appears to queue file changes without processing them
4. **Medium** — presentation layer performs too much construction/orchestration inline
5. **Medium** — indexing/search paths are simple and correct for small-to-medium workloads, but will struggle at larger vault sizes

If only three items are addressed first, they should be:

1. add canonical path containment checks (`realpath` / symlink-safe validation)
2. harden SSE transport defaults
3. fix watcher-driven indexing so file changes actually reindex reliably

---

## Severity Matrix

| Severity | Finding | Primary Area |
|---|---|---|
| Critical | Missing symlink / canonical containment checks | Security |
| High | SSE transport too permissive | Security / Transport |
| High | Watcher queue appears never drained | Correctness / Search |
| High | Unexpected error messages may leak internals | Security / DX |
| Medium | Presentation layer constructs many use cases inline | Architecture |
| Medium | Startup and reindex flows are memory-heavy | Performance |
| Medium | Indexing is sequential across files and chunks | Performance |
| Medium | Silent background/indexing failures reduce observability | Reliability |
| Medium | Directory filtering is lexical rather than normalized/canonical | Correctness |
| Low | Documentation/test-count mismatch in docs | Docs / Maintenance |

---

## Repository Context

### Documentation pattern

Top-level project docs currently live at the repository root:

- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `CLAUDE.md`

That makes a root-level `audit.md` a good fit for the existing repository pattern.

### Architecture shape

The repository follows a recognizable Clean Architecture layout:

```text
src/
├── domain/           Errors, ports, value objects
├── use-cases/        Business logic
├── infrastructure/   Adapters
└── presentation/     MCP tools and transport
```

This structure is real, not just aspirational, but there are some important consistency gaps described below.

---

## Detailed Findings

## 1. Security Assessment

### 1.1 Critical — lexical path safety is strong, but physical containment is incomplete

**Relevant files:**

- `src/domain/value-objects/safe-path.ts`
- `src/infrastructure/local-fs-adapter.ts`
- `src/use-cases/vault-indexer.ts`

### What is good

`SafePath` is one of the stronger parts of the codebase. It already blocks:

- `../` traversal
- backslash traversal
- URL-encoded traversal
- double-encoded traversal
- null byte injection
- empty and whitespace-only paths

This is materially better than many file-serving tools.

### The problem

The current defense is **lexical**. It validates the user-supplied path string, but it does not prove that the resolved filesystem target remains inside the vault once symlinks are involved.

Example risk:

```text
vault/
└── notes/
    └── outside.md -> /etc/passwd   (symlink)
```

`notes/outside.md` is lexically inside the vault, but physically outside it.

### Why it matters

Once `..` traversal is blocked, symlink escape is the next real boundary failure for a local file server.

### Recommendation

Keep `SafePath` as the lexical validation layer, but add **filesystem-level containment** in the adapter:

- resolve vault root with `fs.realpath`
- on reads, verify the resolved target is still under the real vault root
- on writes, verify the parent directory is under the real vault root before creating or renaming files
- reject symlinked ancestors that escape the vault

### Example remediation sketch

```ts
const realVaultRoot = await fs.realpath(vaultRoot);
const realTarget = await fs.realpath(targetPath);

if (
  realTarget !== realVaultRoot &&
  !realTarget.startsWith(realVaultRoot + path.sep)
) {
  throw new InvalidPathError("Resolved path escapes vault root");
}
```

For writes, validate `realpath(parentDir)` before writing the temp file.

### Additional note

`SafePath.create(VAULT_ROOT, "/etc/passwd")` is intentionally treated as vault-relative `etc/passwd.md`, not rejected. That is internally consistent, but surprising. Rejecting absolute-style input outright would be safer and easier to reason about.

---

### 1.2 High — SSE transport is under-hardened for HTTP exposure

**Relevant file:** `src/presentation/transport.ts`

### Observed behavior

- `app.use(cors())` enables permissive default CORS behavior
- `express.json()` is used without explicit body size limits
- no visible host/origin validation
- no rate limiting
- no session TTL / idle expiration
- simple bearer token auth only

### Why it matters

For a local-only process using stdio, this is fine. For HTTP/SSE exposure, these defaults are too permissive, especially against cross-origin misuse and local-network attack patterns such as DNS rebinding.

### Recommendation

- restrict CORS or disable it by default in SSE mode
- set `express.json({ limit: "256kb" })` or similar
- validate `Host` and/or `Origin` for SSE deployments
- add rate limiting to `/messages`
- enforce idle timeout / maximum concurrent sessions
- keep auth enabled by default for SSE in deployment docs

---

### 1.3 High — unexpected exceptions may leak internal details

**Relevant file:** `src/presentation/mcp-tools.ts`

`wrapTool()` formats `DomainError` nicely as `[code] message`, but non-domain failures return raw `err.message`.

### Risk

This can leak implementation details from parsers, adapters, or third-party libraries when the service is exposed via SSE.

### Recommendation

- return generic client-safe error text for unexpected failures
- log detailed diagnostics server-side
- reserve raw exception text for debug mode only

---

### 1.4 Security strengths worth preserving

The codebase already has several good security choices:

- central path validation via `SafePath`
- atomic temp-file writes in `LocalFileSystemAdapter`
- Zod validation for MCP tool inputs
- constant-time bearer token comparison in `auth-middleware.ts`
- separation of most file IO behind adapter boundaries

These should be preserved while hardening the remaining gaps.

---

## 2. Correctness and Reliability

### 2.1 High — watcher-driven indexing appears incomplete

**Relevant file:** `src/use-cases/vault-indexer.ts`

### Observation

`startWatching()` debounces file events and calls `enqueue(relPath)`, but it does not appear to call `processQueue()` afterward. The queue and processing methods both exist, but the watcher path stops at enqueue.

### Why this matters

The file implies that background auto-indexing should keep the semantic index fresh. If the queue is never processed, changed files may stop being reindexed after startup.

### Recommendation

Use one of these approaches:

#### Option A — process immediately after debounce

```ts
const timer = setTimeout(async () => {
  this.debounceTimers.delete(relPath);
  this.enqueue(relPath);
  await this.processQueue();
}, debounceMs);
```

#### Option B — serialized worker loop

- debounce into queue
- signal a single worker
- process queue with backpressure and duplicate collapse

Option B is better for scale, but Option A is the fastest fix.

### Follow-up tests to add

- file add triggers indexing
- file change updates search results
- file delete removes document from vector store
- rapid repeated writes coalesce correctly

---

### 2.2 Medium — silent indexing failures reduce observability

**Relevant files:**

- `src/use-cases/vault-indexer.ts`
- `src/presentation/mcp-tools.ts`

### Observed behavior

- `indexAll()` catches per-file failures and ignores them
- background `indexFile()` / `removeFile()` calls are often `.catch(() => {/* background */})`

### Tradeoff

This keeps tool responses fast and resilient, but it can also hide degraded indexing from users and maintainers.

### Recommendation

- log file path + error summary
- track counts for indexing failures and last failed path
- surface indexing health in `system.status`

---

### 2.3 Medium — directory scoping is lexical, not normalized

**Relevant file:** `src/use-cases/hybrid-search.ts`

Directory filters are currently implemented via prefix matching on stored doc paths.

That is probably acceptable for internal indexed paths, but it is still weaker than normalizing and comparing once at a single boundary.

### Recommendation

- normalize directory filters to canonical vault-relative prefixes before comparison
- share the same path normalization strategy across lexical search and semantic search

---

## 3. Clean Architecture and Best Practices

### 3.1 Overall assessment

This project does follow Clean Architecture in a meaningful way.

### Strong examples

- `src/domain/` remains pure
- `MarkdownFileRepository` cleanly composes parsing with the filesystem adapter
- `LocalFileSystemAdapter` keeps file IO in infrastructure
- use cases for frontmatter, read-by-heading, dry-run edit, and bulk-read are well separated

### Where the boundary is weaker

#### A. `VaultIndexer` uses infrastructure APIs directly

**Relevant file:** `src/use-cases/vault-indexer.ts`

It directly imports:

- `node:fs/promises`
- `node:path`
- `chokidar`

This makes the use case less portable and less consistent with the rest of the ports/adapters approach.

#### B. `mcp-tools.ts` acts as controller + factory + orchestrator

**Relevant file:** `src/presentation/mcp-tools.ts`

The transport layer does more than input mapping. It also:

- instantiates many use cases inline
- coordinates backlinks and indexing
- performs operational orchestration
- formats error output and response hints

That is workable, but it makes the presentation layer heavier than a pure transport adapter.

### Recommendation

Refactor toward this shape:

```text
MCP Transport
  ↓
Application Facade / Tool Service
  ↓
Use Cases
  ↓
Ports
  ↓
Infrastructure Adapters
```

### Specific refactor ideas

1. Introduce service-level facades:
   - `VaultToolService`
   - `EditToolService`
   - `ViewToolService`
   - `SystemToolService`

2. Construct long-lived dependencies once in `src/index.ts` or a composition module

3. Inject those services into `createMcpServer()` instead of instantiating many use cases inside each tool handler

4. Move indexing file enumeration and file IO behind ports if long-term architecture purity matters

---

### 3.2 Medium — composition root is good, but some responsibilities are split awkwardly

**Relevant files:**

- `src/index.ts`
- `src/presentation/mcp-tools.ts`

`src/index.ts` does a good job as the composition root, but some lifecycle work is still partially handled down in the tool layer.

Examples:

- backlink updates are coordinated in tool handlers
- indexing refreshes are fired from presentation code
- reindex rebuild logic mixes concerns between application behavior and transport response behavior

### Recommendation

Move these coordination flows into application-level services so that presentation remains thin and predictable.

---

## 4. Testing Strategy

## 4.1 Current testing posture

The project already has a good automated testing base.

### Observed strengths

- 38 `*.test.ts` files found under `src/`
- strong use of real temp directories for filesystem behavior
- strong MCP integration pattern using `InMemoryTransport.createLinkedPair()`
- good coverage around `SafePath`, adapter behavior, vector-store persistence, startup checks, and AST-related functionality

### High-quality examples already present

#### `src/presentation/mcp-tools.test.ts`

This is a notably good integration-test pattern for MCP servers:

- real MCP server instance
- in-memory linked transport pair
- real temp vault
- real adapter and workflow machinery
- tool-level assertions over JSON response envelopes

This should remain the foundation of the integration test strategy.

#### `src/domain/value-objects/safe-path.test.ts`

Strong lexical path traversal coverage already exists:

- encoded traversal
- double-encoded traversal
- backslash traversal
- null bytes
- empty and whitespace-only paths

#### `src/infrastructure/local-fs-adapter.test.ts`

The use of real temp directories instead of mocks is exactly the right choice for adapter tests.

---

## 4.2 Gaps in current test coverage

### Security test gaps

- symlink escape on read
- symlink escape on write via parent directory
- permission-denied behavior
- malformed `%` sequences / pathological decode input
- Windows drive-letter and UNC path cases

### Transport test gaps

- host/origin validation in SSE mode
- oversized request body behavior
- malformed JSON-RPC payloads
- error propagation on failed `server.connect()` / `handlePostMessage()`
- stale or invalid session handling edge cases beyond happy-path checks

### MCP protocol test gaps

- initialize/handshake edge cases
- capability declaration / schema validation snapshots
- auth + tool invocation together
- concurrent clients in SSE mode

### Indexing/search gaps

- file watcher actually updates semantic index after changes
- delete/unlink removes vectors correctly
- reindex failure observability
- large vault indexing behavior

---

## 4.3 Recommended testing strategy for this MCP server

Use a four-layer approach.

### Layer 1 — Unit tests

Target pure logic:

- `SafePath`
- AST navigation and patching
- chunking and scoring
- fuzzy matching
- workflow transitions

### Layer 2 — Integration tests

Target internal system boundaries:

- MCP tools with in-memory transport
- real temp vaults
- filesystem adapter + repository interactions
- vector store persistence behavior

### Layer 3 — End-to-end tests

Run the built server as a real process:

- stdio subprocess test lane
- SSE server test lane
- auth-enabled SSE test lane

Verify:

- initialization handshake
- tool listing
- representative CRUD/search/edit flows
- error and auth behavior
- concurrent client isolation in SSE mode

### Layer 4 — MCP conformance

Add conformance testing in CI using official MCP tooling where possible.

Example direction:

```bash
npx @modelcontextprotocol/conformance server --url http://localhost:3000/mcp
```

Exact endpoint wiring depends on how conformance is integrated with the SDK transport.

---

## 4.4 Recommended next tests to implement

### Highest priority

1. symlink containment tests for `SafePath` + `LocalFileSystemAdapter`
2. watcher-driven reindex integration tests for `VaultIndexer`
3. SSE hardening tests: CORS/origin/body-size/session validation
4. auth + tool-call integration tests
5. real-process E2E stdio smoke test

---

## 5. Performance and Optimization Review

## 5.1 Current strengths

The design direction is good:

- heading-aware chunking is a strong retrieval unit
- hybrid lexical + vector scoring is a sensible strategy
- local persisted vector store is pragmatic
- optional external vector DB support keeps a good upgrade path

---

## 5.2 Performance bottlenecks

### A. Medium — startup and reindex are eager and memory-heavy

**Relevant files:**

- `src/index.ts`
- `src/presentation/mcp-tools.ts`

Observed patterns:

- startup indexes the full vault
- backlink rebuild reads many/all files into memory
- `Promise.all(readNote)` can scale poorly for large vaults

### Recommendation

- batch backlink rebuilds instead of reading the whole vault at once
- stream or chunk work during startup
- avoid full-vault memory spikes during reindex

---

### B. Medium — indexing is sequential across files and chunks

**Relevant file:** `src/use-cases/vault-indexer.ts`

Current behavior:

- files indexed one by one
- chunks embedded one by one
- no bounded concurrency
- no batching

### Recommendation

- add bounded concurrency per file
- add bounded concurrency per chunk embedding
- batch embeddings if provider supports it
- track throughput and failures as metrics

---

### C. Medium — query-time caching is absent

**Relevant file:** `src/use-cases/hybrid-search.ts`

The query is embedded every time and lexical scoring is recomputed over candidates each time.

### Recommendation

- add small in-memory cache for recent query embeddings
- consider caching top candidate sets for repeated searches
- invalidate conservatively on index updates

---

### D. Medium — persisted flat vector store may become expensive at scale

**Relevant area:** local persisted vector store

The current persisted local store is reasonable for small-to-medium datasets, but long-term scaling concerns are visible:

- save path rewrites stored artifacts fully
- load path eagerly loads vectors/doc metadata
- memory footprint grows with entire index size

### Recommendation

Longer-term options:

- use SQLite FTS for lexical search
- keep vector search in Qdrant or another vector backend for larger vaults
- use incremental persistence or segment-based storage for local mode if staying file-based

---

## 6. Future Development and Roadmap

## 6.1 Near-term roadmap (stabilization)

### Phase 1 — Security and correctness hardening

- add symlink-safe path containment
- reject absolute-style path inputs explicitly
- harden SSE defaults
- fix watcher queue processing
- make unexpected errors generic externally
- add tests for all of the above

### Phase 2 — Reliability and observability

- add indexing failure logging and counters
- surface indexing health in `system.status`
- add session limits/timeouts for SSE
- add E2E stdio/SSE smoke tests

---

## 6.2 Mid-term roadmap (architecture cleanup)

- introduce application-level tool services/facades
- reduce inline use-case construction in `mcp-tools.ts`
- move more lifecycle coordination out of transport layer
- normalize path handling consistently across search and indexing code

---

## 6.3 Long-term roadmap (scale and product depth)

- stronger tag and metadata query APIs
- more Obsidian/Logseq compatibility helpers
- richer wikilink graph operations
- hybrid retrieval at larger scale (FTS + vector DB)
- incremental indexing journal / checkpointing
- better operational diagnostics and progress reporting

---

## Planning-Ready Remediation Backlog

## P0 — Immediate

### P0.1 Symlink-safe filesystem containment

**Goal:** ensure all reads/writes remain physically inside vault root.

**Likely files:**

- `src/infrastructure/local-fs-adapter.ts`
- `src/domain/value-objects/safe-path.ts`
- possibly new helper in infrastructure for resolved-path containment
- related tests in:
  - `src/domain/value-objects/safe-path.test.ts`
  - `src/infrastructure/local-fs-adapter.test.ts`

**Acceptance criteria:**

- read through symlink escaping vault is rejected
- write through symlinked parent escaping vault is rejected
- normal vault reads/writes still work
- tests cover symlink and non-symlink cases

---

### P0.2 Fix watcher queue processing

**Goal:** ensure file changes actually trigger reindexing.

**Likely files:**

- `src/use-cases/vault-indexer.ts`
- `src/use-cases/vault-indexer.test.ts` or equivalent integration test file

**Acceptance criteria:**

- add/change/unlink events result in expected index updates
- queue drains deterministically
- repeated changes debounce correctly

---

### P0.3 Harden SSE transport defaults

**Goal:** reduce attack surface for HTTP/SSE deployment.

**Likely files:**

- `src/presentation/transport.ts`
- `src/presentation/transport.test.ts`
- docs: `README.md`, `SECURITY.md`

**Acceptance criteria:**

- explicit JSON body limit
- restricted CORS or configurable allowlist
- session validation and/or timeout improvements
- tests cover rejection behavior

---

## P1 — Next

### P1.1 Improve error sanitization

**Goal:** avoid leaking internals through MCP responses.

**Likely files:**

- `src/presentation/mcp-tools.ts`
- tests in `src/presentation/mcp-tools.test.ts`

**Acceptance criteria:**

- domain errors remain machine-readable
- unexpected errors return generic client-safe text
- internal details still logged for maintainers

---

### P1.2 Add indexing health visibility

**Goal:** make indexing failures visible and diagnosable.

**Likely files:**

- `src/use-cases/vault-indexer.ts`
- `src/presentation/mcp-tools.ts`
- `src/presentation/mcp-tools.test.ts`

**Acceptance criteria:**

- `system.status` exposes useful indexing health indicators
- failures increment counters / record timestamps

---

## P2 — Structural cleanup

### P2.1 Introduce tool services / application facades

**Goal:** thin out presentation layer and centralize orchestration.

**Likely files:**

- `src/presentation/mcp-tools.ts`
- new application/service files
- `src/index.ts`

**Acceptance criteria:**

- `mcp-tools.ts` mostly validates input and delegates
- use-case construction happens in composition code, not per request

---

### P2.2 Performance scaling improvements

**Goal:** improve large-vault behavior.

**Likely areas:**

- `src/use-cases/vault-indexer.ts`
- `src/use-cases/hybrid-search.ts`
- local vector store implementation

**Acceptance criteria:**

- bounded indexing concurrency
- reduced reindex memory spikes
- optional query embedding cache

---

## Suggested Decision Log Entries

When implementing the remediation plan, capture these decisions explicitly:

1. whether absolute-style paths should be rejected or normalized vault-relative
2. whether SSE mode should be considered trusted-local-only or hardened for broader use
3. whether `VaultIndexer` remains a use case or moves toward infrastructure/service territory
4. whether local search should stay fully in-memory or evolve toward SQLite FTS / hybrid persistence

---

## Concrete Evidence References

The following files were central to the audit and should be re-read during planning:

- `src/domain/value-objects/safe-path.ts`
- `src/domain/value-objects/safe-path.test.ts`
- `src/infrastructure/local-fs-adapter.ts`
- `src/infrastructure/local-fs-adapter.test.ts`
- `src/presentation/transport.ts`
- `src/presentation/transport.test.ts`
- `src/presentation/auth-middleware.ts`
- `src/presentation/mcp-tools.ts`
- `src/presentation/mcp-tools.test.ts`
- `src/use-cases/vault-indexer.ts`
- `src/use-cases/hybrid-search.ts`
- `src/infrastructure/markdown-file-repository.ts`
- `src/index.ts`

---

## Final Assessment

### Overall

This project is in good shape. The architecture is better than average, the testing baseline is real, and the design choices around AST editing, hybrid retrieval, and clean layering are thoughtful.

### Main conclusion

This is **not** a repo that needs a rewrite. It needs a focused hardening and refinement pass.

### Best next move

Start with a short, security-first remediation cycle:

1. symlink-safe containment
2. watcher correctness fix
3. SSE transport hardening
4. test expansion around those areas

If those are handled well, the rest of the roadmap becomes incremental improvement rather than risk reduction.
