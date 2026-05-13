# Audit Remediation: P0 + P1 Security & Correctness Fixes

## TL;DR

> **Quick Summary**: Fix critical security vulnerabilities (symlink escape, watcher queue bug, SSE exposure, error leaks) identified in the code audit, with TDD approach and clean architecture refactoring of the VaultIndexer.
> 
> **Deliverables**:
> - Symlink containment via `fs.realpath()` in LocalFileSystemAdapter
> - Absolute path rejection in SafePath (POSIX + Windows forms)
> - VaultIndexer watcher bug fix + refactor behind ports/adapters
> - SSE hardening: loopback bind, configurable body limit, localhost CORS
> - Error sanitization: plain Errors → DomainErrors, generic message for unexpected
> - Indexing health visibility in `system.status`
> 
> **Estimated Effort**: Medium-Large (2-3 days)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 5 → Task 9 → Task 10 → Final Verification

---

## Context

### Original Request
Remediate findings from `audit.md` covering P0 (Critical + High severity) and P1 scope. Excludes P2 architectural refactoring of mcp-tools.ts and performance work.

### Interview Summary
**Key Discussions**:
- **SSE trust model**: Bind to loopback (127.0.0.1) by default, env var `HOST_BIND_ADDRESS` for Docker (0.0.0.0)
- **Symlinks**: Allowed if `fs.realpath()` resolves inside vault root; for new writes validate nearest existing parent
- **Windows support**: Add validation for Windows absolute paths (drive letters, UNC) + tests
- **Body limit**: Configurable via env var, default 1mb
- **Validation errors**: Convert plain `Error` in mcp-tools.ts to `DomainError` subclasses (keep actionable messages)
- **VaultIndexer**: Fix bug AND refactor — extract fs/chokidar behind ports (IFileWatcher + IFileSystemAdapter)
- **Test strategy**: TDD (Red-Green-Refactor) for all changes

**Research Findings**:
- `SafePath` (115 lines): purely lexical — `path.resolve()` + `startsWith()`, no realpath
- `LocalFileSystemAdapter` (154 lines): zero symlink checks, uses raw `fs` calls
- `VaultIndexer` (209 lines): `enqueue()` called in debounce but `processQueue()` never invoked after
- `transport.ts` (142 lines): `cors()` all origins, `express.json()` no limit, no rate limiting
- `wrapTool()` in `mcp-tools.ts` (lines 516-539): non-DomainError → raw `err.message` leaked

### Metis/Oracle Review
**Identified Gaps** (addressed in plan):
- New file writes: can't realpath non-existent file → validate nearest existing parent's canonical path
- `processQueue()` needs serialization guard (mutex/flag) to prevent concurrent runs
- Express body-parser errors (413, 400) also need sanitization — transport-level error middleware
- Existing tests need intentional updates: `transport.test.ts` (expects `*` CORS), `vault-indexer.test.ts` (manually drains queue)
- Vault root itself could be a symlink → resolve once at startup, store canonical root
- `system.status` health fields: startup state, watcher state, queue depth, failure count, last failure metadata

---

## Work Objectives

### Core Objective
Close all P0 (Critical + High) and P1 security/correctness vulnerabilities identified in the audit without breaking existing functionality.

### Concrete Deliverables
- `src/domain/errors/` — New error subclasses: `AbsolutePathError`, `SymlinkEscapeError`, `InvalidArgumentError`
- `src/domain/ports/` — `IFileWatcher` interface
- `src/domain/value-objects/safe-path.ts` — Reject absolute paths (POSIX + Windows)
- `src/infrastructure/local-fs-adapter.ts` — Symlink containment via realpath
- `src/use-cases/vault-indexer.ts` — Fixed watcher + refactored behind ports
- `src/presentation/transport.ts` — Loopback bind, body limit, CORS, error middleware
- `src/presentation/mcp-tools.ts` — Error conversion + sanitization
- Updated `system.status` output with health fields

### Definition of Done
- [ ] `npm test` — all tests pass (existing + new)
- [ ] `npm run lint` — zero errors
- [ ] `npm run build` — compiles clean
- [ ] Symlink escape test: symlink pointing outside vault → rejected
- [ ] Absolute path test: `/etc/passwd`, `C:\Windows`, `\\server\share` → rejected
- [ ] Watcher test: file change → auto-indexed without manual processQueue call
- [ ] SSE test: non-localhost origin → rejected; oversized body → 413
- [ ] Error test: unexpected throw → generic message to client, full error logged server-side

### Must Have
- TDD: Every fix starts with a RED test, then GREEN implementation, then REFACTOR
- Realpath containment checks on ALL file operations (read, write, delete, exists, stat, list)
- Serialization guard preventing concurrent `processQueue()` runs
- Transport-level error middleware (not just tool-level sanitization)
- Existing tests updated to match new behavior (not just added alongside)
- Vault root resolved via `fs.realpath()` once at startup

### Must NOT Have (Guardrails)
- No full internet-facing HTTP hardening (rate limiting, TLS, proxy trust, CSRF, IP allowlists)
- No broad observability/logging platform beyond stderr + system.status fields
- No repo-wide clean-architecture rewrite outside VaultIndexer
- No mcp-tools.ts refactor to facades/controllers (P2 scope)
- No SQLite FTS, query caching, or performance batching
- No new npm dependencies for rate limiting, logging frameworks, or auth libraries
- No debug mode env var exposing full errors to clients

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: TDD (Red-Green-Refactor)
- **Framework**: vitest (`npx vitest run`)
- **Each task**: Write failing test → minimal implementation → refactor

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Security**: Use Bash — attempt symlink escape, absolute paths, oversized bodies → assert rejection
- **Correctness**: Use Bash — trigger watcher events, verify queue processes automatically
- **API**: Use Bash (curl) — send requests to SSE transport, assert status codes + response format
- **Integration**: Use Bash — `npm test && npm run lint && npm run build`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, interfaces, config — immediate start):
├── Task 1: DomainError subclasses [quick]
├── Task 2: IFileWatcher port interface [quick]
├── Task 3: Environment config for new settings [quick]
└── Task 8: VaultIndexer processQueue fix + serialization [deep]

Wave 2 (Core Security — depends on Wave 1, MAX PARALLEL):
├── Task 4: SafePath absolute path rejection + Windows (depends: 1) [deep]
├── Task 5: LocalFileSystemAdapter symlink containment (depends: 1) [deep]
├── Task 6: mcp-tools.ts error conversion + sanitization (depends: 1) [unspecified-high]
└── Task 7: transport.ts SSE hardening (depends: 3) [unspecified-high]

Wave 3 (Refactor + Health — after core fixes):
├── Task 9: VaultIndexer refactor IO behind ports (depends: 2, 5, 8) [deep]
└── Task 10: system.status health fields (depends: 9) [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real QA execution (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

**Critical Path**: Task 1 → Task 5 → Task 9 → Task 10 → Final Verification
**Parallel Speedup**: ~60% faster than sequential
**Max Concurrent**: 5 (Wave 2)

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1 | — | 4, 5, 6 |
| 2 | — | 9 |
| 3 | — | 7 |
| 4 | 1 | — |
| 5 | 1 | 9 |
| 6 | 1 | — |
| 7 | 3 | — |
| 8 | — | 9 |
| 9 | 2, 5, 8 | 10 |
| 10 | 9 | — |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1 → `quick`, T2 → `quick`, T3 → `quick`, T8 → `deep`
- **Wave 2**: 4 tasks — T4 → `deep`, T5 → `deep`, T6 → `unspecified-high`, T7 → `unspecified-high`
- **Wave 3**: 2 tasks — T9 → `deep`, T10 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

 - [x] 1. Define new DomainError subclasses

  **What to do**:
  - Create `AbsolutePathError` (extends `DomainError`, code: `ABSOLUTE_PATH_REJECTED`) — thrown when input path is absolute (POSIX or Windows)
  - Create `SymlinkEscapeError` (extends `DomainError`, code: `SYMLINK_ESCAPE_DETECTED`) — thrown when realpath resolves outside vault
  - Create `InvalidArgumentError` (extends `DomainError`, code: `INVALID_ARGUMENT`) — thrown for required argument validation (replaces plain `Error` in mcp-tools.ts)
  - Add all three to barrel export in `src/domain/errors/index.ts`
  - TDD: Write tests first verifying each error has correct `code`, `message`, and extends `DomainError`

  **Must NOT do**:
  - Do not modify any existing error classes
  - Do not add logging or side effects in error constructors

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple class definitions following existing DomainError pattern, minimal code
  - **Skills**: []
    - No special skills needed — straightforward TypeScript class creation
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/domain/errors/domain-errors.ts` — Existing `DomainError` base class and subclasses (e.g., `PathTraversalError`, `NoteNotFoundError`). Follow exact same pattern: extend `DomainError`, pass code + message to super, export from index.
  - `src/domain/errors/domain-errors.test.ts` — Existing test pattern for error classes. Follow same describe/it structure.

  **API/Type References**:
  - `src/domain/errors/index.ts` — Barrel export file where new errors must be added

  **WHY Each Reference Matters**:
  - `domain-errors.ts`: Copy the exact class shape (constructor signature, super call, code field) to maintain consistency
  - `domain-errors.test.ts`: Follow the same test style so the test file stays cohesive
  - `index.ts`: The barrel ensures all consumers import from one location

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/domain/errors/domain-errors.test.ts` → PASS (existing + 3 new test cases)
  - [ ] Each error class: `new AbsolutePathError("/etc/passwd").code === "ABSOLUTE_PATH_REJECTED"`
  - [ ] Each error class: `instanceof DomainError === true`
  - [ ] Barrel export: `import { AbsolutePathError, SymlinkEscapeError, InvalidArgumentError } from '../domain/errors/index.js'` compiles

  **QA Scenarios**:

  ```
  Scenario: Error classes instantiate with correct code and message
    Tool: Bash
    Preconditions: npm install completed
    Steps:
      1. Run: npx vitest run src/domain/errors/domain-errors.test.ts
      2. Assert: output contains "3 passed" for new tests (or total increases by 3)
      3. Assert: exit code 0
    Expected Result: All new error class tests pass
    Failure Indicators: "FAIL" in output, non-zero exit code
    Evidence: .sisyphus/evidence/task-1-error-classes-test.txt

  Scenario: Barrel export includes new errors
    Tool: Bash
    Preconditions: Build succeeds
    Steps:
      1. Run: npx tsc --noEmit src/domain/errors/index.ts
      2. Assert: exit code 0 (no type errors)
    Expected Result: Clean compilation with new exports
    Failure Indicators: TypeScript compilation error
    Evidence: .sisyphus/evidence/task-1-barrel-export.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(domain): add AbsolutePathError, SymlinkEscapeError, InvalidArgumentError`
  - Files: `src/domain/errors/domain-errors.ts`, `src/domain/errors/domain-errors.test.ts`, `src/domain/errors/index.ts`
  - Pre-commit: `npx vitest run src/domain/errors/`

 - [x] 2. Define IFileWatcher port interface

  **What to do**:
  - Create `src/domain/ports/file-watcher.port.ts` with `IFileWatcher` interface
  - Interface should define: `watch(vaultPath: string, options: WatchOptions): void`, `on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void`, `close(): Promise<void>`
  - Define `WatchOptions` type: `{ ignored?: string[], persistent?: boolean }`
  - Export from `src/domain/ports/index.ts` (create barrel if doesn't exist, or add to existing)
  - TDD: Write a simple type-check test confirming the interface compiles and can be implemented

  **Must NOT do**:
  - Do not implement the interface (that's Task 9)
  - Do not import chokidar or any infrastructure dependency
  - Do not add methods beyond watch/on/close (keep minimal)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single interface definition, minimal code
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/domain/ports/` — Check if directory exists and what port interfaces already look like. If `IFileSystemAdapter` is defined here, follow its style (separate file per port, barrel export).
  - `src/domain/ports/file-system.port.ts` (or wherever `IFileSystemAdapter` lives) — Follow the same interface style: pure interface, no implementation, JSDoc on methods.

  **API/Type References**:
  - `src/use-cases/vault-indexer.ts:1-30` — See how `chokidar.watch()` is currently called (lines ~150-180) to understand what methods the interface needs to abstract

  **WHY Each Reference Matters**:
  - Existing ports: Ensures naming and file structure matches project conventions
  - VaultIndexer chokidar usage: The interface must cover all chokidar methods currently used (watch, on events, close)

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` → clean (interface compiles without errors)
  - [ ] Interface exported from barrel: `import { IFileWatcher } from '../domain/ports/index.js'`
  - [ ] Interface covers all chokidar methods used in vault-indexer.ts

  **QA Scenarios**:

  ```
  Scenario: Interface compiles and is importable
    Tool: Bash
    Preconditions: npm install completed
    Steps:
      1. Run: npx tsc --noEmit
      2. Assert: exit code 0
      3. Verify: grep -l "IFileWatcher" src/domain/ports/index.ts (file contains export)
    Expected Result: TypeScript compiles clean, interface is exported
    Failure Indicators: Type error, missing export
    Evidence: .sisyphus/evidence/task-2-interface-compile.txt

  Scenario: Interface shape matches chokidar usage in VaultIndexer
    Tool: Bash
    Preconditions: Interface file created
    Steps:
      1. Read src/domain/ports/file-watcher.port.ts
      2. Verify it has: watch method, on method with 'add'|'change'|'unlink' events, close method
      3. Verify no infrastructure imports
    Expected Result: Interface covers watch/on/close without importing chokidar
    Failure Indicators: Missing methods, chokidar import present
    Evidence: .sisyphus/evidence/task-2-interface-shape.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(domain): add IFileWatcher port interface`
  - Files: `src/domain/ports/file-watcher.port.ts`, `src/domain/ports/index.ts`
  - Pre-commit: `npx tsc --noEmit`

 - [x] 3. Environment configuration for new settings

  **What to do**:
  - Add new env var handling in `src/index.ts` (composition root) or appropriate config location:
    - `HOST_BIND_ADDRESS`: default `'127.0.0.1'`, allows `'0.0.0.0'` for Docker
    - `BODY_LIMIT_BYTES`: default `'1mb'`, passed to `express.json({ limit })`
  - Pass these values to transport creation (update `createSseApp` signature or config object)
  - TDD: Test that defaults apply when env vars unset, and custom values are passed through

  **Must NOT do**:
  - Do not implement the actual transport changes (that's Task 7)
  - Do not add a config library dependency
  - Do not validate values beyond basic type (no regex for IP addresses)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small config addition to existing composition root pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/index.ts` — Composition root. See how existing env vars (`VAULT_PATH`, `MCP_TRANSPORT_TYPE`, `PORT`, `OLLAMA_URL`, etc.) are read and passed. Follow same pattern.
  - `src/presentation/transport.ts:createSseApp()` — Current function signature. Need to understand what params it already accepts to plan how to add new ones.

  **API/Type References**:
  - `src/presentation/transport.ts` — The `createSseApp` function type/params that will consume these config values

  **External References**:
  - Express `express.json()` accepts `{ limit: string }` — e.g., `'1mb'`, `'256kb'`

  **WHY Each Reference Matters**:
  - `src/index.ts`: Follow the exact env var reading pattern (process.env.X || default)
  - `transport.ts`: Need to know current function signature to extend it compatibly

  **Acceptance Criteria**:
  - [ ] `HOST_BIND_ADDRESS` defaults to `'127.0.0.1'` when unset
  - [ ] `BODY_LIMIT_BYTES` defaults to `'1mb'` when unset
  - [ ] Config values are available to `createSseApp` (via updated params/config object)
  - [ ] `npx vitest run` for relevant test file → PASS

  **QA Scenarios**:

  ```
  Scenario: Default values apply when env vars not set
    Tool: Bash
    Preconditions: No HOST_BIND_ADDRESS or BODY_LIMIT_BYTES in environment
    Steps:
      1. Run relevant test: npx vitest run src/index.test.ts (or src/presentation/transport.test.ts)
      2. Assert: tests verify default '127.0.0.1' and '1mb' are used
    Expected Result: Defaults applied correctly
    Failure Indicators: Test failure showing wrong defaults
    Evidence: .sisyphus/evidence/task-3-env-defaults.txt

  Scenario: Custom values are passed through
    Tool: Bash
    Preconditions: Test sets HOST_BIND_ADDRESS='0.0.0.0' and BODY_LIMIT_BYTES='2mb'
    Steps:
      1. Run test that sets env vars and verifies they reach transport config
      2. Assert: custom values propagated
    Expected Result: Custom env var values override defaults
    Failure Indicators: Test still sees default values
    Evidence: .sisyphus/evidence/task-3-env-custom.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(config): add HOST_BIND_ADDRESS and BODY_LIMIT_BYTES env vars`
  - Files: `src/index.ts`, relevant test file
  - Pre-commit: `npx vitest run`

 - [x] 4. SafePath: Reject absolute paths (POSIX + Windows)

  **What to do**:
  - In `SafePath` constructor/`validate()`, add check BEFORE `path.resolve()`:
    - Reject if input starts with `/` (POSIX absolute)
    - Reject if input matches `^[A-Za-z]:[/\\]` (Windows drive letter)
    - Reject if input starts with `\\\\` or `//` (UNC paths)
    - Reject if input contains URL-encoded `/` (`%2F`, `%2f`)
  - Throw `AbsolutePathError` with the offending path in the message
  - Handle edge case: literal `/` input (reject — not a valid note path)
  - TDD: Write failing tests FIRST for each rejection case, then implement

  **Must NOT do**:
  - Do not modify the existing `startsWith()` containment check (that stays as defense-in-depth)
  - Do not add platform detection — reject ALL forms on ALL platforms
  - Do not strip/normalize absolute paths to relative (reject, don't fix)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Security-critical path validation with many edge cases, needs careful TDD
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None — pure logic, no external tools needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8)
  - **Blocks**: None
  - **Blocked By**: Task 1 (needs `AbsolutePathError`)

  **References**:

  **Pattern References**:
  - `src/domain/value-objects/safe-path.ts` — Full file (115 lines). The `validate()` method (around line 30-70) is where rejection logic should go. Current checks: null bytes, `..` traversal, `startsWith()` containment. Add absolute path check BEFORE resolve.
  - `src/domain/value-objects/safe-path.test.ts` — Existing test file. Add new describe block for absolute path rejection.

  **API/Type References**:
  - `AbsolutePathError` from Task 1 — the error to throw

  **WHY Each Reference Matters**:
  - `safe-path.ts`: Must understand the validation flow order — new check goes early, before `path.resolve()` which would otherwise normalize absolute paths into vault-relative
  - `safe-path.test.ts`: Follow existing test structure for new cases

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/domain/value-objects/safe-path.test.ts` → PASS
  - [ ] `/etc/passwd` → throws `AbsolutePathError`
  - [ ] `C:\Windows\system32` → throws `AbsolutePathError`
  - [ ] `C:/Users/file.md` → throws `AbsolutePathError`
  - [ ] `\\\\server\\share\\file.md` → throws `AbsolutePathError`
  - [ ] `//server/share` → throws `AbsolutePathError`
  - [ ] `%2Fetc%2Fpasswd` → throws `AbsolutePathError`
  - [ ] `/` alone → throws `AbsolutePathError`
  - [ ] `///foo` → throws `AbsolutePathError`
  - [ ] `notes/valid.md` → still works (no regression)
  - [ ] `sub/dir/file.md` → still works (no regression)

  **QA Scenarios**:

  ```
  Scenario: POSIX absolute paths are rejected
    Tool: Bash
    Preconditions: Task 1 complete (AbsolutePathError exists)
    Steps:
      1. Run: npx vitest run src/domain/value-objects/safe-path.test.ts --reporter=verbose
      2. Assert: tests for "/etc/passwd", "/", "///foo" all pass with AbsolutePathError
      3. Assert: exit code 0
    Expected Result: All POSIX absolute path inputs throw AbsolutePathError
    Failure Indicators: Tests fail or wrong error type thrown
    Evidence: .sisyphus/evidence/task-4-posix-absolute.txt

  Scenario: Windows absolute paths are rejected
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: npx vitest run src/domain/value-objects/safe-path.test.ts --reporter=verbose
      2. Assert: tests for "C:\\Windows", "C:/Users", "\\\\server\\share" all pass
      3. Assert: exit code 0
    Expected Result: All Windows path forms throw AbsolutePathError
    Failure Indicators: Tests fail, paths not caught
    Evidence: .sisyphus/evidence/task-4-windows-absolute.txt

  Scenario: Existing relative paths still work (no regression)
    Tool: Bash
    Preconditions: Implementation complete
    Steps:
      1. Run: npx vitest run src/domain/value-objects/safe-path.test.ts
      2. Assert: ALL existing tests still pass (not just new ones)
      3. Assert: "notes/valid.md", "sub/dir/file.md" resolve correctly
    Expected Result: Zero regressions in existing SafePath behavior
    Failure Indicators: Previously passing tests now fail
    Evidence: .sisyphus/evidence/task-4-no-regression.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(security): reject absolute paths in SafePath (POSIX + Windows + UNC)`
  - Files: `src/domain/value-objects/safe-path.ts`, `src/domain/value-objects/safe-path.test.ts`
  - Pre-commit: `npx vitest run src/domain/value-objects/`

 - [x] 5. LocalFileSystemAdapter: Symlink containment via realpath

  **What to do**:
  - At adapter construction/initialization: resolve vault root via `fs.realpath()` and store as `canonicalRoot`
  - For ALL file operations (read, write, delete, exists, stat, list):
    - **Existing file**: `fs.realpath(targetPath)` → verify `startsWith(canonicalRoot)`
    - **New file (write/mkdir)**: walk UP from target to find nearest existing ancestor → `fs.realpath(ancestor)` → verify containment → then allow write
  - Throw `SymlinkEscapeError` when containment check fails
  - Handle edge case: vault root itself is a symlink (resolve once at startup, store canonical)
  - TDD: Create temp dirs with symlinks pointing outside, verify rejection

  **Must NOT do**:
  - Do not ban all symlinks — only reject those resolving OUTSIDE vault
  - Do not modify SafePath (that's a separate layer)
  - Do not add caching of realpath results (premature optimization)
  - Do not change the atomic write pattern (temp file + rename)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Security-critical, requires careful handling of edge cases (non-existent paths, parent traversal), filesystem semantics
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None — pure Node.js fs operations

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7, 8)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1 (needs `SymlinkEscapeError`)

  **References**:

  **Pattern References**:
  - `src/infrastructure/local-fs-adapter.ts` — Full file (154 lines). Every method (`readFile`, `writeFile`, `deleteFile`, `exists`, `stat`, `listFiles`, `createDirectory`) needs containment check before the actual fs operation.
  - `src/infrastructure/local-fs-adapter.test.ts` — Existing tests using real temp directories. Add symlink-specific test cases following same pattern.

  **API/Type References**:
  - `src/domain/ports/file-system.port.ts` (or wherever `IFileSystemAdapter` is defined) — The interface contract. Containment is an implementation detail, interface stays unchanged.
  - `SymlinkEscapeError` from Task 1 — the error to throw

  **External References**:
  - Node.js `fs.realpath()` / `fs.promises.realpath()` — resolves symlinks to canonical path

  **WHY Each Reference Matters**:
  - `local-fs-adapter.ts`: Must add containment check to EVERY method — understanding current method list is critical
  - `local-fs-adapter.test.ts`: Follow the real-temp-directory testing pattern (no mocks)
  - Interface port: Verify containment doesn't change the interface contract

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/infrastructure/local-fs-adapter.test.ts` → PASS
  - [ ] Symlink pointing outside vault → read throws `SymlinkEscapeError`
  - [ ] Symlink pointing outside vault → write throws `SymlinkEscapeError`
  - [ ] Symlink pointing outside vault → delete throws `SymlinkEscapeError`
  - [ ] Symlink pointing INSIDE vault → operations succeed normally
  - [ ] New file write under symlinked parent pointing outside → rejected
  - [ ] Vault root is a symlink → resolved at startup, operations work correctly
  - [ ] Existing non-symlink operations → zero regressions

  **QA Scenarios**:

  ```
  Scenario: Symlink escape is blocked for read operations
    Tool: Bash
    Preconditions: Temp vault with symlink pointing to /tmp/outside-vault/secret.md
    Steps:
      1. Run: npx vitest run src/infrastructure/local-fs-adapter.test.ts --reporter=verbose
      2. Assert: test "rejects read through symlink escaping vault" passes
      3. Assert: SymlinkEscapeError thrown with descriptive message
    Expected Result: Read through escaping symlink is rejected
    Failure Indicators: File content returned instead of error
    Evidence: .sisyphus/evidence/task-5-symlink-read-escape.txt

  Scenario: Symlink inside vault is allowed
    Tool: Bash
    Preconditions: Temp vault with symlink pointing to another file INSIDE vault
    Steps:
      1. Run test that creates internal symlink and reads through it
      2. Assert: content returned successfully (no error)
    Expected Result: Internal symlinks work normally
    Failure Indicators: SymlinkEscapeError thrown for valid internal symlink
    Evidence: .sisyphus/evidence/task-5-symlink-internal-allowed.txt

  Scenario: New file write under symlinked parent outside vault is blocked
    Tool: Bash
    Preconditions: Temp vault with dir symlink to /tmp/outside/
    Steps:
      1. Run test: adapter.writeFile("symlinked-dir/new-file.md", "content")
      2. Assert: SymlinkEscapeError thrown
      3. Assert: no file created outside vault
    Expected Result: Write blocked, no side effects
    Failure Indicators: File created outside vault boundary
    Evidence: .sisyphus/evidence/task-5-write-parent-escape.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(security): add realpath symlink containment to LocalFileSystemAdapter`
  - Files: `src/infrastructure/local-fs-adapter.ts`, `src/infrastructure/local-fs-adapter.test.ts`
  - Pre-commit: `npx vitest run src/infrastructure/`

 - [x] 6. mcp-tools.ts: Error conversion + sanitization

  **What to do**:
  - **Step 1**: Identify all `throw new Error('...')` in mcp-tools.ts that are expected validation failures (e.g., "path is required", "action is required", "invalid operation"). Convert each to appropriate DomainError subclass:
    - Missing required params → `InvalidArgumentError`
    - Invalid enum values → `InvalidArgumentError`
  - **Step 2**: In `wrapTool()` catch block (lines 516-539):
    - If `err instanceof DomainError`: return `err.message` (keep as-is — actionable)
    - If NOT DomainError: return generic `"Internal error occurred"`, log full error to stderr (`console.error('Unexpected tool error:', err)`)
  - **Note**: Transport-level error middleware (413/400 for body-parser errors) is handled by Task 7 (SSE hardening) to avoid parallel conflicts on transport.ts
  - TDD: Test each conversion and the sanitization behavior

  **Must NOT do**:
  - Do not restructure mcp-tools.ts architecture (no facades, no splitting)
  - Do not add a debug mode env var to expose full errors to clients
  - Do not change the error response format for DomainErrors (backwards compatible)
  - Do not catch errors that should propagate (e.g., system crashes)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Touches many throw sites across a large file (539 lines), requires careful identification of expected vs unexpected errors
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 7, 8)
  - **Blocks**: None
  - **Blocked By**: Task 1 (needs `InvalidArgumentError`)

  **References**:

  **Pattern References**:
  - `src/presentation/mcp-tools.ts:516-539` — `wrapTool()` function. Current catch: `if (err instanceof DomainError)` → return err.message, else → return `err.message` (BUG: leaks). Fix the else branch.
  - `src/presentation/mcp-tools.ts:1-80` — Tool registration area. Search for `throw new Error(` to find all plain Error throws that need conversion.

  **API/Type References**:
  - `InvalidArgumentError` from Task 1 — replacement for plain `Error` throws
  - `src/domain/errors/index.ts` — Import path for new errors

  **External References**:
  - Express error middleware pattern: `app.use((err, req, res, next) => {...})` — must be registered AFTER routes

  **WHY Each Reference Matters**:
  - `wrapTool()`: The single point where ALL tool errors pass through — the fix goes here
  - Tool registration area: Need to find ALL `throw new Error()` instances to convert
  - Express error middleware: Body-parser errors bypass tool-level handling entirely, need separate middleware

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/presentation/mcp-tools.test.ts` → PASS
  - [ ] `npx vitest run src/presentation/transport.test.ts` → PASS
  - [ ] Zero `throw new Error(` remaining in mcp-tools.ts (all converted to DomainError subclasses)
  - [ ] Unexpected error in tool → client receives "Internal error occurred", stderr gets full error
  - [ ] Missing required param → client receives actionable `InvalidArgumentError` message

  **QA Scenarios**:

  ```
  Scenario: Unexpected errors are sanitized
    Tool: Bash
    Preconditions: Implementation complete, tests written
    Steps:
      1. Run: npx vitest run src/presentation/mcp-tools.test.ts --reporter=verbose
      2. Assert: test "returns generic message for non-DomainError" passes
      3. Assert: test verifies console.error was called with original error
    Expected Result: Client gets "Internal error occurred", server logs full error
    Failure Indicators: Raw error message visible in tool response
    Evidence: .sisyphus/evidence/task-6-error-sanitization.txt

  Scenario: Validation errors remain actionable
    Tool: Bash
    Preconditions: Plain Error throws converted to InvalidArgumentError
    Steps:
      1. Run: npx vitest run src/presentation/mcp-tools.test.ts
      2. Assert: test "returns actionable message for InvalidArgumentError" passes
      3. Assert: client receives specific message like "path is required"
    Expected Result: DomainError messages pass through unchanged
    Failure Indicators: Generic "Internal error" returned for expected validation failure
    Evidence: .sisyphus/evidence/task-6-validation-errors.txt

  Scenario: Express body-parser errors return clean JSON
    Tool: Bash
    Preconditions: Transport error middleware added
    Steps:
      1. Run: npx vitest run src/presentation/transport.test.ts
      2. Assert: test "returns 413 for oversized body" passes with clean JSON
      3. Assert: test "returns 400 for malformed JSON" passes with clean JSON
      4. Assert: no stack traces in response bodies
    Expected Result: Transport-level errors return structured JSON, no leaks
    Failure Indicators: HTML error page, stack trace in response, or raw parser message
    Evidence: .sisyphus/evidence/task-6-transport-errors.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(security): sanitize unexpected errors, convert validation to DomainError`
  - Files: `src/presentation/mcp-tools.ts`, `src/presentation/mcp-tools.test.ts`
  - Pre-commit: `npx vitest run src/presentation/`

- [x] 7. transport.ts: SSE hardening (loopback, body limit, CORS, error middleware)

  **What to do**:
  - **Loopback bind**: Change `app.listen(port)` to `app.listen(port, hostBindAddress)` where `hostBindAddress` comes from config (Task 3). Default: `'127.0.0.1'`.
  - **Body limit**: Replace `app.use(express.json())` with `app.use(express.json({ limit: bodyLimit }))` where `bodyLimit` comes from config (Task 3). Default: `'1mb'`.
  - **CORS restriction**: Replace `app.use(cors())` with configured CORS that only allows localhost origins: `cors({ origin: (origin, cb) => { if (!origin || isLocalhostOrigin(origin)) cb(null, true); else cb(new Error('blocked')); } })`. Allow requests without Origin header (non-browser clients).
  - **Error middleware**: Add Express error handler AFTER all routes: return structured JSON for 413/400/CORS errors without leaking internals (see Task 6 Step 3 — coordinate or implement here).
  - TDD: Update existing transport tests + add new ones for each hardening measure
  - **IMPORTANT**: Existing `transport.test.ts` expects `*` CORS — update those tests to match new behavior

  **Must NOT do**:
  - Do not add rate limiting (out of scope)
  - Do not add TLS/HTTPS (out of scope)
  - Do not add session TTL management
  - Do not add IP allowlisting beyond loopback bind
  - Do not add helmet or other security middleware libraries

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Modifies Express transport layer with multiple hardening concerns, requires updating existing tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None — standard Express/Node.js work

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6, 8)
  - **Blocks**: None
  - **Blocked By**: Task 3 (needs config values for host/limit)

  **References**:

  **Pattern References**:
  - `src/presentation/transport.ts` — Full file (142 lines). Key areas: `createSseApp()` function, `app.use(cors())` line, `app.use(express.json())` line, `app.listen(port)` call.
  - `src/presentation/transport.test.ts` — Existing tests that assert CORS behavior (likely expect `*`). Must be updated.

  **API/Type References**:
  - Config values from Task 3: `hostBindAddress` and `bodyLimit` parameters
  - Express `cors()` options: `{ origin: function }` pattern for dynamic origin validation

  **External References**:
  - Express CORS middleware: `cors({ origin: (origin, callback) => {...} })` pattern
  - Express error middleware: 4-argument `(err, req, res, next)` function signature

  **WHY Each Reference Matters**:
  - `transport.ts`: Direct modification target — understand current structure before changing
  - `transport.test.ts`: Tests WILL break with CORS changes — must be updated intentionally
  - CORS middleware docs: Dynamic origin validation is non-trivial (null origin from non-browser clients)

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/presentation/transport.test.ts` → PASS (updated tests)
  - [ ] Server binds to `127.0.0.1` by default (not `0.0.0.0`)
  - [ ] `HOST_BIND_ADDRESS=0.0.0.0` → binds to all interfaces
  - [ ] Request with no `Origin` header → allowed (non-browser clients work)
  - [ ] Request with `Origin: http://localhost:3000` → allowed
  - [ ] Request with `Origin: http://evil.com` → CORS rejected
  - [ ] Body > configured limit → 413 JSON response (no HTML, no stack)
  - [ ] Malformed JSON body → 400 JSON response (no stack)

  **QA Scenarios**:

  ```
  Scenario: Loopback bind by default
    Tool: Bash
    Preconditions: Server started without HOST_BIND_ADDRESS
    Steps:
      1. Run transport test that verifies listen call uses '127.0.0.1'
      2. Assert: test passes
    Expected Result: Default bind address is 127.0.0.1
    Failure Indicators: Binds to 0.0.0.0 or undefined
    Evidence: .sisyphus/evidence/task-7-loopback-bind.txt

  Scenario: Non-localhost origin is rejected
    Tool: Bash
    Preconditions: SSE server running in test
    Steps:
      1. Run: npx vitest run src/presentation/transport.test.ts --reporter=verbose
      2. Assert: test sending request with Origin: http://evil.com gets CORS rejection
      3. Assert: test sending request with Origin: http://localhost:3000 succeeds
      4. Assert: test sending request without Origin header succeeds
    Expected Result: Only localhost origins (and no-origin) pass CORS check
    Failure Indicators: Foreign origin accepted, or no-origin rejected
    Evidence: .sisyphus/evidence/task-7-cors-restriction.txt

  Scenario: Oversized body returns structured 413
    Tool: Bash
    Preconditions: Body limit configured to small value in test (e.g., '100b')
    Steps:
      1. Run transport test that sends body exceeding limit
      2. Assert: response status 413
      3. Assert: response body is JSON `{ "error": "Payload too large" }`
      4. Assert: no stack trace or HTML in response
    Expected Result: Clean 413 JSON, no leaks
    Failure Indicators: HTML response, stack trace, or 500 status
    Evidence: .sisyphus/evidence/task-7-body-limit.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(security): harden SSE transport — loopback bind, body limit, CORS restriction`
  - Files: `src/presentation/transport.ts`, `src/presentation/transport.test.ts`
  - Pre-commit: `npx vitest run src/presentation/`

 - [x] 8. VaultIndexer: Fix processQueue not called + serialization guard

  **What to do**:
  - **Fix the bug**: In `startWatching()`, after the debounce timer fires and calls `this.enqueue(relPath)`, ALSO call `this.processQueue()` (or better: call a new `drain()` method that includes serialization)
  - **Add serialization guard**: Prevent concurrent `processQueue()` runs. Add `private isProcessing = false` flag. If `processQueue()` is called while already running, skip (the current run will pick up new items). After processing completes, check if queue has new items and re-drain if needed.
  - **Ensure no stranded items**: After `isProcessing` is released, if queue length > 0, re-enter drain loop
  - **Add health counters**: Track `failureCount`, `lastFailureTime`, `lastFailureSource` on the indexer instance (used by Task 10 for status exposure)
  - TDD: Write tests that simulate rapid file events and verify all get processed

  **Must NOT do**:
  - Do not refactor the IO layer yet (that's Task 9)
  - Do not change the existing `processQueue()` logic beyond adding serialization
  - Do not add external queue libraries or job systems
  - Do not change debounce timing values

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Concurrency correctness is tricky — serialization guards, re-drain after completion, race conditions in tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None — pure async/await logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 9
  - **Blocked By**: None (can start immediately — fix is independent of IFileWatcher interface)

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-indexer.ts:150-209` — `startWatching()` method with the debounce logic and `enqueue()` call. Line 182: `this.enqueue(relPath)` — this is where `processQueue()` should be called after.
  - `src/use-cases/vault-indexer.ts:100-149` — `processQueue()` method. Understand its current loop structure before adding serialization.
  - `src/use-cases/vault-indexer.test.ts` — Existing tests that MANUALLY call `processQueue()`. These must be updated — watcher should auto-drain.

  **API/Type References**:
  - `IFileWatcher` from Task 2 — understand the target interface shape (won't implement yet, but helps design the fix knowing refactor comes next)

  **WHY Each Reference Matters**:
  - `startWatching()`: The exact location of the bug — must add processQueue call after enqueue
  - `processQueue()`: Must understand loop structure to safely add serialization without breaking existing logic
  - Existing tests: Currently manually drain — need to verify they still pass AND add new auto-drain tests

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-indexer.test.ts` → PASS
  - [ ] File change event → indexed automatically (no manual processQueue call needed)
  - [ ] Rapid burst of 10 file events → all eventually processed (deduplication is fine)
  - [ ] Concurrent processQueue calls → only one runs at a time (serialization)
  - [ ] Queue has items after processing completes → re-drains automatically
  - [ ] Processing failure → `failureCount` incremented, `lastFailureTime` set, watcher continues
  - [ ] Existing manually-triggered tests still pass (backwards compatible)

  **QA Scenarios**:

  ```
  Scenario: File changes are auto-indexed without manual processQueue
    Tool: Bash
    Preconditions: VaultIndexer with watcher started
    Steps:
      1. Run: npx vitest run src/use-cases/vault-indexer.test.ts --reporter=verbose
      2. Assert: test "auto-processes queue after file change" passes
      3. Assert: no manual processQueue() call in new test
    Expected Result: Watcher auto-drains queue after debounce
    Failure Indicators: Queue stuck with items, processQueue never called
    Evidence: .sisyphus/evidence/task-8-auto-drain.txt

  Scenario: Serialization prevents concurrent processing
    Tool: Bash
    Preconditions: Tests trigger rapid sequential enqueue+drain
    Steps:
      1. Run test that fires multiple near-simultaneous drain attempts
      2. Assert: only one processQueue runs at a time (verified via counter or mock)
      3. Assert: all items eventually processed
    Expected Result: Serialized execution, no duplicates, no missed items
    Failure Indicators: Concurrent runs detected, items processed twice, or items stranded
    Evidence: .sisyphus/evidence/task-8-serialization.txt

  Scenario: Failures tracked in health counters
    Tool: Bash
    Preconditions: Test injects a file that causes indexing failure
    Steps:
      1. Run test that indexes a file causing an error
      2. Assert: failureCount incremented by 1
      3. Assert: lastFailureTime is recent timestamp
      4. Assert: watcher continues processing subsequent files
    Expected Result: Failure tracked, watcher not crashed
    Failure Indicators: Counter not incremented, or watcher stops after failure
    Evidence: .sisyphus/evidence/task-8-health-counters.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(indexer): auto-drain queue after watcher events, add serialization guard`
  - Files: `src/use-cases/vault-indexer.ts`, `src/use-cases/vault-indexer.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/`

- [x] 9. VaultIndexer: Refactor IO behind IFileSystemAdapter + IFileWatcher

  **What to do**:
  - **Extract chokidar**: Replace direct `chokidar.watch()` usage with injected `IFileWatcher` dependency. Create `ChokidarFileWatcher` adapter in `src/infrastructure/` that implements `IFileWatcher`.
  - **Extract fs calls**: Replace direct `fs.readdir`, `fs.readFile` in VaultIndexer with calls to injected `IFileSystemAdapter` (which already exists and is used by other layers).
  - **Constructor injection**: Update VaultIndexer constructor to accept `IFileWatcher` and `IFileSystemAdapter` as dependencies (in addition to existing deps like embedding provider, vector store).
  - **Update composition root**: Wire `ChokidarFileWatcher` and `LocalFileSystemAdapter` into VaultIndexer in `src/index.ts`.
  - **Preserve behavior**: Refactoring only — all existing behavior (debounce, queue, serialization from Task 8) stays identical.
  - TDD: Existing tests should still pass. Add tests using mock IFileWatcher to verify watcher integration without real filesystem.

  **Must NOT do**:
  - Do not change business logic (debounce timing, queue processing, chunk/embed pipeline)
  - Do not add new features during refactoring
  - Do not create a general job/worker abstraction
  - Do not modify IFileSystemAdapter interface (use existing methods)
  - Do not remove the direct chokidar dependency from package.json (adapter still uses it)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Refactoring with behavior preservation — must maintain serialization/debounce semantics while swapping implementations
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None — standard dependency injection refactoring

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on both Wave 2 outputs)
  - **Parallel Group**: Wave 3 (with Task 10, but 10 depends on 9)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 2 (IFileWatcher interface), 5 (containment in adapter), 8 (fixed processQueue)

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-indexer.ts` — Full file after Task 8 fixes. Identify all `import ... from 'chokidar'`, `import ... from 'node:fs/promises'`, and replace with injected dependencies.
  - `src/infrastructure/local-fs-adapter.ts` — Existing adapter pattern to follow for `ChokidarFileWatcher`
  - `src/index.ts` — Composition root where new wiring happens. See how other adapters are instantiated and passed.

  **API/Type References**:
  - `src/domain/ports/file-watcher.port.ts` (Task 2) — Interface that `ChokidarFileWatcher` must implement
  - `src/domain/ports/file-system.port.ts` — `IFileSystemAdapter` interface (already exists) — methods available for replacing raw fs calls

  **WHY Each Reference Matters**:
  - `vault-indexer.ts`: The refactoring target — must identify every direct IO import/call
  - `local-fs-adapter.ts`: Template for creating new infrastructure adapter (same pattern)
  - `src/index.ts`: Wiring location — must update constructor call with new dependencies
  - Port interfaces: The contracts to implement/use

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-indexer.test.ts` → PASS (behavior preserved)
  - [ ] `npx vitest run src/infrastructure/` → PASS (new ChokidarFileWatcher tests)
  - [ ] Zero `import ... from 'chokidar'` in `src/use-cases/` (moved to infrastructure)
  - [ ] Zero `import ... from 'node:fs/promises'` in `vault-indexer.ts` (uses IFileSystemAdapter)
  - [ ] VaultIndexer constructor accepts `IFileWatcher` + `IFileSystemAdapter` params
  - [ ] `ChokidarFileWatcher` implements `IFileWatcher` in `src/infrastructure/`
  - [ ] Composition root wires concrete adapters → VaultIndexer
  - [ ] `npm run build` → clean compile (no broken imports)

  **QA Scenarios**:

  ```
  Scenario: VaultIndexer has no direct infrastructure imports
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: grep -n "from 'chokidar'" src/use-cases/vault-indexer.ts
      2. Assert: no matches (exit code 1)
      3. Run: grep -n "from 'node:fs" src/use-cases/vault-indexer.ts
      4. Assert: no matches (exit code 1)
    Expected Result: Use case has zero infrastructure imports
    Failure Indicators: Any chokidar or fs import found in use-case layer
    Evidence: .sisyphus/evidence/task-9-no-infra-imports.txt

  Scenario: All existing behavior preserved after refactoring
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: npx vitest run src/use-cases/vault-indexer.test.ts --reporter=verbose
      2. Assert: ALL existing tests pass (not just new ones)
      3. Assert: auto-drain from Task 8 still works
      4. Assert: serialization guard from Task 8 still works
    Expected Result: Zero behavior changes — pure structural refactoring
    Failure Indicators: Any previously passing test now fails
    Evidence: .sisyphus/evidence/task-9-behavior-preserved.txt

  Scenario: ChokidarFileWatcher adapter works end-to-end
    Tool: Bash
    Preconditions: Adapter created in src/infrastructure/
    Steps:
      1. Run: npx vitest run src/infrastructure/chokidar-file-watcher.test.ts
      2. Assert: tests verify watch/on/close lifecycle
      3. Assert: exit code 0
    Expected Result: Adapter correctly wraps chokidar behind IFileWatcher interface
    Failure Indicators: Test failures in adapter, or interface not fully implemented
    Evidence: .sisyphus/evidence/task-9-chokidar-adapter.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `refactor(indexer): extract chokidar and fs behind IFileWatcher and IFileSystemAdapter ports`
  - Files: `src/use-cases/vault-indexer.ts`, `src/use-cases/vault-indexer.test.ts`, `src/infrastructure/chokidar-file-watcher.ts`, `src/infrastructure/chokidar-file-watcher.test.ts`, `src/index.ts`
  - Pre-commit: `npx vitest run`

- [x] 10. system.status: Indexing health fields

  **What to do**:
  - Extend the `system` tool's `status` action response to include health fields from VaultIndexer:
    - `indexingState`: `'idle' | 'indexing' | 'watching' | 'error'`
    - `watcherState`: `'stopped' | 'active' | 'error'`
    - `queueDepth`: number (items waiting to be processed)
    - `failureCount`: number (total failures since startup)
    - `lastFailure`: `{ time: string, source: string } | null`
    - `indexedDocuments`: number (from existing vector store count)
  - Add a `getHealthStatus()` method to VaultIndexer that returns these fields
  - Update mcp-tools.ts `system` tool handler to call `getHealthStatus()` and include in response
  - TDD: Test health fields in various states (idle, processing, after failure)

  **Must NOT do**:
  - Do not add external monitoring/metrics libraries
  - Do not expose the vault root absolute path in status (information disclosure)
  - Do not add historical failure logs (just latest + count)
  - Do not add performance timing/latency metrics

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Touches both use-case layer (health method) and presentation layer (tool response), moderate complexity
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after Task 9)
  - **Parallel Group**: Wave 3 (after Task 9)
  - **Blocks**: None (final implementation task)
  - **Blocked By**: Task 9 (refactored VaultIndexer with health counters from Task 8)

  **References**:

  **Pattern References**:
  - `src/presentation/mcp-tools.ts` — Find the `system` tool `status` action handler. See what it currently returns. Extend with health fields.
  - `src/use-cases/vault-indexer.ts` (after Tasks 8+9) — Has `failureCount`, `lastFailureTime`, `lastFailureSource` from Task 8. Add `getHealthStatus()` method that aggregates these.

  **API/Type References**:
  - Current `system.status` response shape — whatever is returned now, health fields are ADDED (not replacing)
  - Health counters from Task 8: `failureCount`, `lastFailureTime`, `lastFailureSource`

  **WHY Each Reference Matters**:
  - `mcp-tools.ts` system handler: Where the response is assembled — must add fields here
  - VaultIndexer after refactor: Source of truth for indexing state — must expose via method

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-indexer.test.ts` → PASS
  - [ ] `npx vitest run src/presentation/mcp-tools.test.ts` → PASS
  - [ ] `system.status` response includes `indexingState`, `watcherState`, `queueDepth`, `failureCount`, `lastFailure`, `indexedDocuments`
  - [ ] After fresh start: `indexingState: 'idle'`, `failureCount: 0`, `lastFailure: null`
  - [ ] During indexing: `indexingState: 'indexing'`
  - [ ] After failure: `failureCount: 1`, `lastFailure: { time: "...", source: "..." }`
  - [ ] Vault root path NOT exposed in response

  **QA Scenarios**:

  ```
  Scenario: Health fields present in system.status response
    Tool: Bash
    Preconditions: VaultIndexer with getHealthStatus() method
    Steps:
      1. Run: npx vitest run src/presentation/mcp-tools.test.ts --reporter=verbose
      2. Assert: test "system.status includes health fields" passes
      3. Assert: response contains indexingState, watcherState, queueDepth, failureCount, lastFailure, indexedDocuments
    Expected Result: All 6 health fields present in response
    Failure Indicators: Missing fields, undefined values
    Evidence: .sisyphus/evidence/task-10-health-fields.txt

  Scenario: Health state reflects indexer condition after failure
    Tool: Bash
    Preconditions: Test triggers an indexing failure
    Steps:
      1. Run test that causes one file to fail indexing
      2. Call system.status
      3. Assert: failureCount === 1
      4. Assert: lastFailure.source contains failed file name
      5. Assert: lastFailure.time is ISO timestamp within last second
    Expected Result: Health correctly reflects failure state
    Failure Indicators: failureCount still 0, or lastFailure is null
    Evidence: .sisyphus/evidence/task-10-failure-state.txt

  Scenario: Vault root path not leaked in status
    Tool: Bash
    Preconditions: System status available
    Steps:
      1. Run test that checks system.status response
      2. Assert: response JSON does NOT contain the absolute vault root path
      3. Assert: no field reveals filesystem location
    Expected Result: No information disclosure of server paths
    Failure Indicators: Absolute path like "/Users/..." or "/vault" visible in response
    Evidence: .sisyphus/evidence/task-10-no-path-leak.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(status): expose indexing health fields in system.status`
  - Files: `src/use-cases/vault-indexer.ts`, `src/use-cases/vault-indexer.test.ts`, `src/presentation/mcp-tools.ts`, `src/presentation/mcp-tools.test.ts`
  - Pre-commit: `npx vitest run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run test). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run lint` + `npm run build` + `npm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod (except intentional error logging), commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA Execution** — `unspecified-high`
  Start from clean build (`npm run build`). Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (symlink + absolute path combo, watcher + health status, SSE + error sanitization). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff`). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Wave | Message | Pre-commit |
|------------|---------|------------|
| Wave 1 | `feat(domain): add error subclasses, IFileWatcher port, and env config` | `npm test` |
| Wave 2 | `fix(security): symlink containment, abs path rejection, SSE hardening, error sanitization, watcher fix` | `npm test && npm run lint` |
| Wave 3 | `refactor(indexer): extract IO behind ports, add health status fields` | `npm test && npm run lint && npm run build` |

---

## Success Criteria

### Verification Commands
```bash
npm test          # Expected: all tests pass (existing + ~30 new)
npm run lint      # Expected: 0 errors
npm run build     # Expected: clean compile to dist/
```

### Final Checklist
- [ ] All "Must Have" items implemented and tested
- [ ] All "Must NOT Have" items absent from codebase
- [ ] All existing tests still pass (updated where needed)
- [ ] New TDD tests cover every security fix
- [ ] `system.status` returns health fields
- [ ] No `as any` or `@ts-ignore` introduced
- [ ] No new npm dependencies added
