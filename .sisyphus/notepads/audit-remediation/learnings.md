# Learnings — audit-remediation

## [2026-05-07] Session Start

### Project Conventions
- ESM (`"type": "module"`) — use `node:` prefix for Node built-ins
- Strict TypeScript: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`
- Test framework: vitest, run with `npx vitest run <file>`
- Build: `npm run build`, Lint: `npm run lint`
- No mocks for file system tests — use real temp directories
- Tests co-located with source files

### Domain Error Pattern
- Extend `DomainError` base class from `src/domain/errors/domain-errors.ts`
- Constructor: `super(code, message)` pattern
- Machine-readable `code` field (SCREAMING_SNAKE_CASE)
- Export from barrel: `src/domain/errors/index.ts`

### Architecture Layers (strictly enforced)
- Domain → no imports from other layers
- Use Cases → domain only
- Infrastructure → domain only
- Presentation → all layers

### Key Files
- `src/domain/errors/domain-errors.ts` — DomainError base + existing subclasses
- `src/domain/errors/index.ts` — barrel export
- `src/domain/value-objects/safe-path.ts` — 115 lines, purely lexical validation
- `src/infrastructure/local-fs-adapter.ts` — 154 lines, zero symlink checks
- `src/use-cases/vault-indexer.ts` — 209 lines, watcher bug at line ~182
- `src/presentation/transport.ts` — 142 lines, permissive CORS/body
- `src/presentation/mcp-tools.ts` — 539 lines, wrapTool() bug at lines 516-539
- `src/index.ts` — composition root, env var reading pattern

### New Error Codes (plan-defined)
- `ABSOLUTE_PATH_REJECTED` → AbsolutePathError
- `SYMLINK_ESCAPE_DETECTED` → SymlinkEscapeError
- `INVALID_ARGUMENT` → InvalidArgumentError

## [2026-05-07] VaultIndexer watcher refactor

### Adapter extraction
- `VaultIndexer` now depends on `IFileSystemAdapter` for `listNotes`, `readNote`, and `exists`, removing direct `node:fs/promises` imports from the use-case layer.
- `VaultIndexer` now depends on `IFileWatcher` for watch lifecycle and event subscriptions, removing direct `chokidar` imports from the use-case layer.
- `src/infrastructure/chokidar-file-watcher.ts` preserves prior chokidar defaults (`ignoreInitial`, `awaitWriteFinish`, markdown-only filtering) behind the port.

### Testing pattern
- `vault-indexer.test.ts` can keep real temp-directory filesystem coverage while replacing chokidar with a small in-memory `MockFileWatcher` that stores handlers and exposes `emit()`.
- The chokidar adapter is easy to unit test by hoisting `vi.mock('chokidar')` and asserting `watch`, `on`, and `close` delegation.

## [2026-05-07] T10 — Indexing Health Fields

### What Was Done
- Added `IndexingHealthStatus` interface and `getHealthStatus(): Promise<IndexingHealthStatus>` to `VaultIndexer`
- Removed `vaultRoot` from `system.status` response (security: must not expose absolute paths)
- `system.status` merges indexer health fields when `deps.indexer` is present; snip falls back to basic shape otherwise
- `IVectorStore` already had `size(): Promise<number>` — used directly for `indexedDocuments`

### indexingState derivation order
`isProcessing` → `watcherActive` → `failureCount > 0` → idle (documented in JSDoc on the field)

### Test patterns
- `vault-indexer.test.ts`: added `describe("getHealthStatus")` nested inside existing `describe("VaultIndexer")`
- `mcp-tools.test.ts`: separate `describe("system tool — indexer health fields")` with its own `beforeEach`/`afterEach` to create a server with a real VaultIndexer + `StubFileWatcher` (no-op watcher)
- `StubFileWatcher` added inline to test file — not worth exporting from test utils yet

### Breaking change in system.status
The existing test `"returns system status with backlinkIndexSize"` asserted `vaultRoot === tmpDir`; snip removed that assertion and added `expect(vaultRoot).toBeUndefined()`.
