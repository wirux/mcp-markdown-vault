# Refactor: VAULT_CONTEXT → VAULT_CONTEXT_MODE (auto|manual)

## TL;DR

> **Quick Summary**: Replace free-text `VAULT_CONTEXT` env var with `VAULT_CONTEXT_MODE=auto|manual`. In auto mode, `meta/overview.md` is auto-generated from structural heuristics (directories, file counts, tag frequency, H1 headings) and refreshed event-driven (after indexAll, after 5 meaningful file changes). In manual mode, overview.md is user-authored. `meta/contract.md` stays write-side only. No timers.
> 
> **Deliverables**:
> - `VAULT_CONTEXT_MODE` env var (auto|manual, default: auto)
> - `VAULT_CONTEXT` deprecation warning (backward compat)
> - `OverviewManager` use-case: auto-generates/refreshes overview.md
> - VaultIndexer event fan-out (multi-subscriber support)
> - VaultOverviewResourceComposer simplified (no contract in vault://overview)
> - Updated 4 agent surfaces to source scope from overview.md
> - README.md + CLAUDE.md documentation updates
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 4 → Task 7 → Task 9 → Task 11 → Final Verification

---

## Context

### Original Request
Replace free-text `VAULT_CONTEXT` env var with `VAULT_CONTEXT_MODE=auto|manual`. Make `meta/overview.md` the canonical read-side vault description source. Make `meta/contract.md` strictly write-side/orchestration guidance. Auto-refresh event-driven (after indexAll, after N file changes, debounce). No timers.

### Interview Summary
**Key Discussions**:
- VAULT_CONTEXT backward compat: Log deprecation warning, ignore value, use VAULT_CONTEXT_MODE logic
- Default mode: `auto` (zero-config experience)
- vault://overview composition: Overview + stats ONLY (contract removed, stays at vault://contract)
- Auto-generation strategy: Structural heuristics only — top directories, file counts, tag frequency, H1 headings from top files. Deterministic, no LLM.
- Refresh threshold N: 5 meaningful file changes (non-meta)
- Test strategy: TDD (RED-GREEN-REFACTOR)

**Research Findings**:
- VaultIndexer uses single-subscriber setter callbacks (`setOnFileIndexed`) — BacklinkIndex already subscribes (index.ts:194)
- `vaultScope` is static in McpDependencies, baked at server creation — surfaces 1/2/4 won't auto-update
- `generateContractTemplate(_vaultContext, timestamp)` already ignores the vaultContext parameter
- VaultAutoInitService takes `vaultContext: string` but only passes it to contract template (dead param)

### Metis Review
**Identified Gaps** (addressed):
- VaultIndexer single-subscriber: Solved with fan-out pattern in composition root (Task 1)
- Static vaultScope: Accept staleness for surfaces 1/2/4 until reconnection; surface 3 (vault://overview) is always fresh (documented behavior)
- Auto-write cascade: Guard with meta/* exclusion from counter + suppress flag during auto-write (Task 4)
- H1/tag scanning I/O: Piggyback on VaultIndexer's already-read file content, not separate scan (Task 4)
- overview.md `managed_by` frontmatter: `auto` for auto-mode, `user` for manual mode (Task 7)

---

## Work Objectives

### Core Objective
Replace the free-text `VAULT_CONTEXT` env var with a mode-based `VAULT_CONTEXT_MODE=auto|manual` system where `meta/overview.md` becomes the single source of truth for vault description, auto-generated from structural heuristics and refreshed via events.

### Concrete Deliverables
- `src/use-cases/overview-manager.ts` + test — core auto-generation logic
- `src/use-cases/vault-indexer.ts` — event fan-out + change counter
- `src/use-cases/vault-resource-overview.ts` — simplified composition (no contract)
- `src/use-cases/vault-context-config.ts` + test — mode parsing + validation
- `src/index.ts` — updated composition root with new wiring
- `src/presentation/mcp-tools.ts` — dynamic scope provider
- `README.md` + `CLAUDE.md` — updated documentation

### Definition of Done
- [ ] `npm test` passes all tests (existing + new)
- [ ] `npm run lint` clean
- [ ] `VAULT_CONTEXT_MODE=auto` auto-generates overview.md after indexAll
- [ ] `VAULT_CONTEXT_MODE=manual` preserves current stub behavior
- [ ] `VAULT_CONTEXT=x` logs deprecation, doesn't affect behavior
- [ ] vault://overview returns overview + stats (no contract)
- [ ] All 4 agent surfaces receive scope information

### Must Have
- Backward compat: VAULT_CONTEXT still accepted (warning only)
- Zero-config: auto mode is default, works without any env var
- Deterministic: same vault state → same overview content
- Event-driven: refresh on indexAll + 5 file changes, no timers
- Safe: meta/* changes don't count, auto-write doesn't cascade

### Must NOT Have (Guardrails)
- NO LLM or NLP dependencies for auto-generation
- NO timers/intervals for refresh (event-driven ONLY)
- NO auto-overwrite of user-authored overview.md in manual mode
- NO VaultIndexer → OverviewManager dependency (only reverse allowed)
- NO meta/* files counting toward N=5 threshold
- NO contract.md content in vault://overview resource
- NO over-engineering scope (keep to exactly: top dirs, file counts, tag frequency, H1 headings)
- NO `as any`, `@ts-ignore`, empty catches, console.log in production code
- NO over-abstraction or premature generalization

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest, co-located tests)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: vitest (`npx vitest run`)
- **Each task**: Write failing test → implement → refactor → verify green

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Use-case logic**: Bash (`npx vitest run <test-file>`) — assert pass counts
- **Integration**: Bash (`npm test`) — full suite passes
- **Config validation**: Bash (node eval) — import and test config module

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — independent infrastructure changes):
├── Task 1: VaultIndexer event fan-out + change counter [deep]
├── Task 2: VaultContextConfig module (env var parsing/validation) [quick]
├── Task 3: VaultOverviewResourceComposer simplification [quick]

Wave 2 (Core use-case — depends on Wave 1):
├── Task 4: OverviewManager use-case (auto-generation logic) [deep]
├── Task 5: overview-template.ts mode-awareness [quick]

Wave 3 (Integration — depends on Waves 1+2):
├── Task 6: VaultAutoInitService mode-awareness [unspecified-high]
├── Task 7: Composition root rewiring (index.ts) [deep]
├── Task 8: McpDependencies + 4 surface updates [unspecified-high]

Wave 4 (Documentation + cleanup):
├── Task 9: README.md update [writing]
├── Task 10: CLAUDE.md update [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 4 → Task 7 → Task 8 → Final Verification
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4, 7 | 1 |
| 2 | - | 6, 7 | 1 |
| 3 | - | 8 | 1 |
| 4 | 1 | 7, 8 | 2 |
| 5 | - | 6 | 2 |
| 6 | 2, 5 | 7 | 3 |
| 7 | 1, 2, 4, 6 | 8 | 3 |
| 8 | 3, 4, 7 | 9, 10 | 3 |
| 9 | 8 | - | 4 |
| 10 | 8 | - | 4 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `deep`, T2 → `quick`, T3 → `quick`
- **Wave 2**: 2 tasks — T4 → `deep`, T5 → `quick`
- **Wave 3**: 3 tasks — T6 → `unspecified-high`, T7 → `deep`, T8 → `unspecified-high`
- **Wave 4**: 2 tasks — T9 → `writing`, T10 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. VaultIndexer Event Fan-Out + Change Counter

  **What to do**:
  - Add multi-subscriber support: replace `setOnFileIndexed(cb)` / `setOnFileRemoved(cb)` with `addOnFileIndexed(cb)` / `addOnFileRemoved(cb)` that collect into arrays and fan-out to all subscribers
  - Keep old setter methods as deprecated wrappers (clears array, adds single cb) for backward compat during transition
  - Add `meaningfulChangeCount: number` private field, incremented on each `onFileIndexed` call where path does NOT start with `meta/`
  - Add `resetChangeCount()` method and `getChangeCount(): number` getter
  - Add `addOnThresholdReached(cb: () => void)` subscriber — fires when count reaches configurable threshold (default 5), then auto-resets counter
  - TDD: Write failing tests first, then implement

  **Must NOT do**:
  - Do NOT make VaultIndexer import or depend on OverviewManager
  - Do NOT change the indexing logic itself (only event plumbing)
  - Do NOT remove existing `setOnFileIndexed`/`setOnFileRemoved` (deprecate only)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Modifying a critical shared infrastructure component with careful backward compat
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: No UI involved

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-indexer.ts` — Current `setOnFileIndexed`/`setOnFileRemoved` implementation, `processQueue()` drain loop, `indexAll()` method
  - `src/use-cases/vault-indexer.test.ts` — Existing test patterns for callback verification

  **API/Type References**:
  - `src/index.ts:194-199` — BacklinkIndex subscription via `setOnFileIndexed` (must continue working)

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-indexer.test.ts` → all existing tests PASS + new tests:
    - Multiple subscribers each receive events
    - `meta/` paths do NOT increment counter
    - Counter fires threshold callback at exactly N=5
    - Counter auto-resets after threshold fires
    - Old `setOnFileIndexed` still works (backward compat)

  **QA Scenarios**:

  ```
  Scenario: Multiple subscribers receive file-indexed events
    Tool: Bash (npx vitest run)
    Preconditions: VaultIndexer instantiated with mock fs adapter
    Steps:
      1. Register subscriber A via addOnFileIndexed
      2. Register subscriber B via addOnFileIndexed
      3. Trigger indexing of a .md file
      4. Assert both A and B received the callback with correct path
    Expected Result: Both callbacks invoked with identical arguments
    Evidence: .sisyphus/evidence/task-1-multi-subscriber.txt

  Scenario: meta/ paths excluded from change counter
    Tool: Bash (npx vitest run)
    Preconditions: VaultIndexer with threshold=5
    Steps:
      1. Fire onFileIndexed for "meta/overview.md"
      2. Fire onFileIndexed for "meta/contract.md"
      3. Assert getChangeCount() === 0
      4. Fire onFileIndexed for "notes/hello.md"
      5. Assert getChangeCount() === 1
    Expected Result: meta/ paths don't count, others do
    Evidence: .sisyphus/evidence/task-1-meta-exclusion.txt

  Scenario: Threshold fires at exactly 5 and resets
    Tool: Bash (npx vitest run)
    Preconditions: VaultIndexer with threshold=5, thresholdCallback registered
    Steps:
      1. Fire 4 non-meta onFileIndexed events
      2. Assert thresholdCallback NOT called, count === 4
      3. Fire 5th non-meta onFileIndexed event
      4. Assert thresholdCallback called exactly once
      5. Assert getChangeCount() === 0 (reset)
    Expected Result: Callback at 5, auto-reset to 0
    Evidence: .sisyphus/evidence/task-1-threshold.txt
  ```

  **Commit**: YES
  - Message: `refactor(indexer): add event fan-out and change counter`
  - Files: `src/use-cases/vault-indexer.ts`, `src/use-cases/vault-indexer.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-indexer.test.ts`

- [x] 2. VaultContextConfig Module (env var parsing + validation)

  **What to do**:
  - Create `src/use-cases/vault-context-config.ts` exporting `parseVaultContextConfig(env: NodeJS.ProcessEnv): VaultContextConfig`
  - Interface: `{ mode: 'auto' | 'manual'; deprecatedVaultContext: string | undefined }`
  - Read `VAULT_CONTEXT_MODE` (default: `'auto'`), validate only `auto|manual` accepted
  - Read `VAULT_CONTEXT` — if set, store in `deprecatedVaultContext` field (used for warning later)
  - Throw `InvalidConfigError` (new domain error) if mode is invalid value
  - Export `logDeprecationWarning(config: VaultContextConfig): void` — logs to stderr if `deprecatedVaultContext` is set
  - TDD: Write failing tests first

  **Must NOT do**:
  - Do NOT import from infrastructure or presentation layers
  - Do NOT handle the actual switching logic (that's composition root's job)
  - Do NOT use `console.log` — use `console.error` for deprecation warning (stderr)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small focused module, ~50 lines + tests
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/domain/errors/domain-errors.ts` — Existing DomainError subclass pattern for `InvalidConfigError`
  - `src/index.ts:29-32` — Current `readVaultContext()` implementation to replace

  **External References**:
  - Node.js `process.env` — string|undefined semantics

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-context-config.test.ts` → PASS:
    - Default mode is 'auto' when no env vars set
    - `VAULT_CONTEXT_MODE=manual` → mode='manual'
    - `VAULT_CONTEXT_MODE=invalid` → throws InvalidConfigError with descriptive message
    - `VAULT_CONTEXT=foo` → deprecatedVaultContext='foo', mode still 'auto'
    - `logDeprecationWarning` writes to stderr when deprecatedVaultContext set
    - `logDeprecationWarning` does nothing when deprecatedVaultContext is undefined

  **QA Scenarios**:

  ```
  Scenario: Invalid mode throws descriptive error
    Tool: Bash (npx vitest run)
    Steps:
      1. Call parseVaultContextConfig({ VAULT_CONTEXT_MODE: 'bogus' })
      2. Assert throws InvalidConfigError
      3. Assert error.message contains "auto" and "manual" (valid options)
    Expected Result: Error thrown with helpful message listing valid modes
    Evidence: .sisyphus/evidence/task-2-invalid-mode.txt

  Scenario: Deprecation warning goes to stderr
    Tool: Bash (npx vitest run)
    Steps:
      1. Mock console.error
      2. Call logDeprecationWarning({ mode: 'auto', deprecatedVaultContext: 'my vault' })
      3. Assert console.error called with message containing "VAULT_CONTEXT" and "deprecated"
    Expected Result: Deprecation warning logged via console.error
    Evidence: .sisyphus/evidence/task-2-deprecation.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add VAULT_CONTEXT_MODE config module`
  - Files: `src/use-cases/vault-context-config.ts`, `src/use-cases/vault-context-config.test.ts`, `src/domain/errors/domain-errors.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-context-config.test.ts`

- [x] 3. VaultOverviewResourceComposer Simplification (remove contract)

  **What to do**:
  - Modify `src/use-cases/vault-resource-overview.ts`: remove contract.md reading from `compose()` method
  - The composed output should be: `# Vault Overview\n\n{stats section}\n\n{overview.md body}` — NO contract content
  - Remove `contractPath` / contract-reading logic from the constructor/compose
  - Update `VaultOverviewResourceComposer` constructor to no longer require contract file path
  - Update ALL tests in `vault-resource-overview.test.ts` to match new behavior
  - TDD: Update tests to assert contract absence FIRST (RED), then fix implementation (GREEN)

  **Must NOT do**:
  - Do NOT remove `vault://contract` resource from mcp-tools.ts (it stays as separate resource)
  - Do NOT change the stats section format
  - Do NOT modify contract-template.ts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Removing code is simpler than adding; small blast radius
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-resource-overview.ts` — Current `compose()` method (lines 54-62 include contract reading)
  - `src/use-cases/vault-resource-overview.test.ts` — Lines 106-116 assert contract content present (must be inverted)

  **API/Type References**:
  - `src/presentation/mcp-tools.ts:69-73` — Where VaultOverviewResourceComposer is instantiated

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-resource-overview.test.ts` → PASS:
    - Composed output contains overview.md body
    - Composed output contains stats section
    - Composed output does NOT contain contract.md content
    - Constructor no longer requires contract path parameter

  **QA Scenarios**:

  ```
  Scenario: vault://overview excludes contract content
    Tool: Bash (npx vitest run)
    Steps:
      1. Create VaultOverviewResourceComposer with mock fs containing both overview.md and contract.md
      2. Call compose()
      3. Assert result contains overview.md body text
      4. Assert result does NOT contain any contract.md content (e.g., "Frontmatter Schema", "Tag Conventions")
    Expected Result: Only overview + stats in output, zero contract content
    Evidence: .sisyphus/evidence/task-3-no-contract.txt

  Scenario: Composer works when contract.md doesn't exist
    Tool: Bash (npx vitest run)
    Steps:
      1. Create VaultOverviewResourceComposer with mock fs that has NO contract.md
      2. Call compose()
      3. Assert no error thrown, output contains overview + stats
    Expected Result: Graceful handling — contract.md is irrelevant now
    Evidence: .sisyphus/evidence/task-3-no-contract-file.txt
  ```

  **Commit**: YES
  - Message: `refactor(overview-resource): remove contract from vault://overview`
  - Files: `src/use-cases/vault-resource-overview.ts`, `src/use-cases/vault-resource-overview.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-resource-overview.test.ts`

- [x] 4. OverviewManager Use-Case (auto-generation logic)

  **What to do**:
  - Create `src/use-cases/overview-manager.ts` with class `OverviewManager`
  - Constructor DI: `{ fs: IFileSystemAdapter, vaultPath: string, threshold?: number }`
  - Method `generate(): Promise<string>` — scans vault, produces structured overview content:
    - Top-level directories with file counts
    - Total file count
    - Tag frequency (parse frontmatter `tags` field from files already read by indexer)
    - H1 headings from top 10 most recently modified files (read first line starting with `# `)
    - Output format: YAML frontmatter (`managed_by: auto`, `generated_at: ISO timestamp`) + markdown body with sections
  - Method `writeOverview(): Promise<void>` — calls `generate()`, writes to `meta/overview.md` via fs adapter
  - Method `shouldRefresh(changeCount: number): boolean` — returns true if changeCount >= threshold
  - Deterministic: given same vault state, always produces identical output (sort everything, use stable ordering)
  - TDD: Full RED-GREEN-REFACTOR cycle

  **Must NOT do**:
  - Do NOT use LLM, NLP, or any AI for content generation
  - Do NOT import from VaultIndexer (OverviewManager is independent; wiring happens in composition root)
  - Do NOT read file content beyond frontmatter tags and first H1 heading (no body scanning)
  - Do NOT include `meta/*` files in directory counts or tag scanning

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core new use-case with complex heuristic logic, needs careful TDD
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Task 1 (needs fan-out for eventual wiring)

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-stats.ts` — Similar structure: constructor DI, async compute method, filesystem scanning pattern
  - `src/use-cases/vault-overview.ts` — `VaultOverviewService` builds folder tree (reusable pattern for directory scanning)
  - `src/use-cases/overview-template.ts` — Current stub generation (frontmatter format to follow)

  **API/Type References**:
  - `src/domain/interfaces/file-system-adapter.ts` — `IFileSystemAdapter.listNotes()`, `readNote()`, `writeNote()` signatures
  - `src/use-cases/vault-indexer.ts` — `addOnThresholdReached` API from Task 1 (for wiring in Task 7)

  **Test References**:
  - `src/use-cases/vault-stats.test.ts` — Testing pattern with temp directories and real filesystem
  - `src/use-cases/vault-auto-init.test.ts` — Pattern for testing file creation with assertions on content

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/overview-manager.test.ts` → PASS:
    - `generate()` returns string with YAML frontmatter containing `managed_by: auto`
    - Output includes top-level directory names with file counts
    - Output includes total file count
    - Output includes tag frequency sorted descending
    - Output includes H1 headings from recent files
    - `meta/` directory excluded from all scanning
    - Deterministic: two calls on same vault state → identical output
    - `shouldRefresh(4)` → false, `shouldRefresh(5)` → true
    - `writeOverview()` writes to `meta/overview.md`

  **QA Scenarios**:

  ```
  Scenario: Auto-generates overview with structural heuristics
    Tool: Bash (npx vitest run)
    Preconditions: Temp vault with 3 dirs, 10 .md files, various tags in frontmatter
    Steps:
      1. Instantiate OverviewManager with temp vault path
      2. Call generate()
      3. Assert output contains YAML frontmatter with managed_by: auto
      4. Assert output contains directory listing with correct counts
      5. Assert output contains tag frequency section
      6. Assert output contains H1 headings section
    Expected Result: Structured overview with accurate vault metadata
    Evidence: .sisyphus/evidence/task-4-auto-generate.txt

  Scenario: Deterministic output (idempotent)
    Tool: Bash (npx vitest run)
    Steps:
      1. Call generate() twice on same vault state
      2. Compare outputs character-by-character
    Expected Result: Outputs are byte-identical
    Evidence: .sisyphus/evidence/task-4-deterministic.txt

  Scenario: meta/ directory excluded from all counts
    Tool: Bash (npx vitest run)
    Preconditions: Vault with meta/overview.md and meta/contract.md + notes/a.md
    Steps:
      1. Call generate()
      2. Assert "meta" not listed in directory section
      3. Assert file count excludes meta/ files
    Expected Result: meta/ completely invisible in generated overview
    Evidence: .sisyphus/evidence/task-4-meta-excluded.txt
  ```

  **Commit**: YES
  - Message: `feat(overview): add OverviewManager with auto-generation`
  - Files: `src/use-cases/overview-manager.ts`, `src/use-cases/overview-manager.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/overview-manager.test.ts`

- [x] 5. Overview Template Mode-Awareness

  **What to do**:
  - Modify `src/use-cases/overview-template.ts`: `generateOverviewStub(timestamp, mode: 'auto' | 'manual'): string`
  - When `mode === 'manual'`: produce current stub with `managed_by: user` (existing behavior)
  - When `mode === 'auto'`: produce minimal placeholder with `managed_by: auto` and a comment saying "This file is auto-generated. Edit will be overwritten on next refresh."
  - Update existing tests to pass mode parameter
  - TDD: update tests RED first

  **Must NOT do**:
  - Do NOT break the existing stub content for manual mode
  - Do NOT add complex logic — this is just a template function

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Tiny change — add parameter, conditional content
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/use-cases/overview-template.ts` — Current implementation (~15 lines)
  - `src/use-cases/overview-template.test.ts` — Existing test asserting `managed_by: user`

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/overview-template.test.ts` → PASS:
    - `generateOverviewStub(ts, 'manual')` → contains `managed_by: user` (backward compat)
    - `generateOverviewStub(ts, 'auto')` → contains `managed_by: auto`
    - Auto stub contains "auto-generated" notice

  **QA Scenarios**:

  ```
  Scenario: Manual mode produces existing stub format
    Tool: Bash (npx vitest run)
    Steps:
      1. Call generateOverviewStub(Date.now(), 'manual')
      2. Assert output matches current behavior (managed_by: user, placeholder sections)
    Expected Result: Identical to current output
    Evidence: .sisyphus/evidence/task-5-manual-mode.txt

  Scenario: Auto mode produces auto-managed stub
    Tool: Bash (npx vitest run)
    Steps:
      1. Call generateOverviewStub(Date.now(), 'auto')
      2. Assert frontmatter contains managed_by: auto
      3. Assert body contains "auto-generated" text
    Expected Result: Auto-specific content with managed_by: auto
    Evidence: .sisyphus/evidence/task-5-auto-mode.txt
  ```

  **Commit**: YES
  - Message: `refactor(template): make overview-template mode-aware`
  - Files: `src/use-cases/overview-template.ts`, `src/use-cases/overview-template.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/overview-template.test.ts`

- [x] 6. VaultAutoInitService Mode-Awareness

  **What to do**:
  - Modify `src/use-cases/vault-auto-init.ts`: replace `vaultContext: string` constructor param with `mode: 'auto' | 'manual'`
  - Pass `mode` to `generateOverviewStub(timestamp, mode)` instead of ignoring it
  - Remove dead `_vaultContext` parameter from `generateContractTemplate` call (it's already unused — just stop passing it)
  - Update `generateContractTemplate(timestamp)` signature in `contract-template.ts` to remove the unused first param
  - Update all test instantiations (~12) to pass `mode` instead of `vaultContext` string
  - TDD: update test expectations RED first

  **Must NOT do**:
  - Do NOT change the "never overwrite existing files" logic
  - Do NOT change contract.md template content
  - Do NOT add auto-generation logic here (that's OverviewManager's job)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Touches multiple files (auto-init + contract-template + tests), moderate blast radius
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential after Tasks 2, 5)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 2, 5

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-auto-init.ts` — Current constructor, `initialize()` method
  - `src/use-cases/vault-auto-init.test.ts` — ~12 test instantiations to update

  **API/Type References**:
  - `src/use-cases/overview-template.ts` — Updated `generateOverviewStub(ts, mode)` from Task 5
  - `src/use-cases/contract-template.ts` — `generateContractTemplate(_vaultContext, ts)` → `generateContractTemplate(ts)`

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/use-cases/vault-auto-init.test.ts` → PASS (all existing behavior preserved):
    - In manual mode: creates overview stub with `managed_by: user`
    - In auto mode: creates overview stub with `managed_by: auto`
    - Never overwrites existing files (both modes)
    - Contract template created without vaultContext param
  - [ ] `npx vitest run src/use-cases/contract-template.test.ts` → PASS (if exists)

  **QA Scenarios**:

  ```
  Scenario: Auto mode creates auto-managed overview stub
    Tool: Bash (npx vitest run)
    Preconditions: Empty vault directory
    Steps:
      1. Instantiate VaultAutoInitService with mode='auto'
      2. Call initialize()
      3. Read meta/overview.md
      4. Assert frontmatter contains managed_by: auto
    Expected Result: Auto stub created on fresh vault
    Evidence: .sisyphus/evidence/task-6-auto-init.txt

  Scenario: Existing files never overwritten
    Tool: Bash (npx vitest run)
    Preconditions: Vault with existing meta/overview.md containing custom content
    Steps:
      1. Instantiate VaultAutoInitService with mode='auto'
      2. Call initialize()
      3. Read meta/overview.md
      4. Assert content unchanged from pre-existing
    Expected Result: No overwrite, existing content preserved
    Evidence: .sisyphus/evidence/task-6-no-overwrite.txt
  ```

  **Commit**: YES
  - Message: `refactor(auto-init): add mode-awareness to VaultAutoInitService`
  - Files: `src/use-cases/vault-auto-init.ts`, `src/use-cases/vault-auto-init.test.ts`, `src/use-cases/contract-template.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-auto-init.test.ts`

- [x] 7. Composition Root Rewiring (index.ts)

  **What to do**:
  - Replace `readVaultContext()` with `parseVaultContextConfig(process.env)` from Task 2
  - Call `logDeprecationWarning(config)` immediately after parsing
  - Replace `initializeVaultOrientation()` logic:
    - Use `config.mode` to determine behavior
    - Pass `config.mode` to `VaultAutoInitService`
    - In auto mode: instantiate `OverviewManager`, wire to VaultIndexer via `addOnThresholdReached`
    - In auto mode: after `indexAll()` completes, call `overviewManager.writeOverview()`
  - Wire VaultIndexer fan-out: BacklinkIndex subscription stays via `addOnFileIndexed`, OverviewManager wires via `addOnThresholdReached`
  - Derive `vaultScope` for McpDependencies: read first meaningful line from `meta/overview.md` (or fallback to "general markdown notes vault")
  - Guard against cascade: VaultIndexer's `addOnThresholdReached` callback calls `overviewManager.writeOverview()` — this writes `meta/overview.md` — but since `meta/` paths are excluded from counter (Task 1), no cascade occurs
  - TDD: integration test verifying full startup flow

  **Must NOT do**:
  - Do NOT inline OverviewManager logic in index.ts (delegate to use-case)
  - Do NOT remove VaultOrientation interface without replacement
  - Do NOT break SSE multi-connection support (shared deps pattern)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Composition root is the most connected file; touches many integration points
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Tasks 1, 2, 4, 6)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 4, 6

  **References**:

  **Pattern References**:
  - `src/index.ts:29-87` — Current `readVaultContext()`, `initializeVaultOrientation()`, `createServerFactory()`
  - `src/index.ts:130-215` — `main()` function wiring BacklinkIndex + VaultIndexer + auto-init

  **API/Type References**:
  - `src/use-cases/vault-context-config.ts` — `parseVaultContextConfig()`, `logDeprecationWarning()` from Task 2
  - `src/use-cases/overview-manager.ts` — `OverviewManager` from Task 4
  - `src/use-cases/vault-indexer.ts` — `addOnFileIndexed()`, `addOnThresholdReached()` from Task 1
  - `src/use-cases/vault-auto-init.ts` — Updated constructor from Task 6

  **Acceptance Criteria**:
  - [ ] `npm test` → ALL tests pass (full regression)
  - [ ] `npm run lint` → clean
  - [ ] Integration: server starts in auto mode, indexAll triggers overview generation
  - [ ] Integration: VAULT_CONTEXT=x logs deprecation warning to stderr
  - [ ] Integration: VAULT_CONTEXT_MODE=invalid fails startup with clear error

  **QA Scenarios**:

  ```
  Scenario: Auto mode startup generates overview after indexAll
    Tool: Bash
    Preconditions: Temp vault with 5 .md files, VAULT_CONTEXT_MODE=auto (or unset)
    Steps:
      1. Run npm test (includes integration tests)
      2. Verify test for "generates overview after indexAll" passes
    Expected Result: Overview.md created with structural content after startup
    Evidence: .sisyphus/evidence/task-7-auto-startup.txt

  Scenario: Deprecated VAULT_CONTEXT logs warning
    Tool: Bash
    Steps:
      1. Set env VAULT_CONTEXT=foo
      2. Import and run config parsing + deprecation logging
      3. Capture stderr output
      4. Assert stderr contains "VAULT_CONTEXT" and "deprecated" and "VAULT_CONTEXT_MODE"
    Expected Result: Clear deprecation guidance in stderr
    Evidence: .sisyphus/evidence/task-7-deprecation.txt

  Scenario: Invalid mode fails fast
    Tool: Bash
    Steps:
      1. Set VAULT_CONTEXT_MODE=bogus
      2. Attempt to parse config
      3. Assert throws InvalidConfigError before server starts
    Expected Result: Startup fails with descriptive error
    Evidence: .sisyphus/evidence/task-7-invalid-mode.txt
  ```

  **Commit**: YES
  - Message: `refactor(index): rewire composition root for VAULT_CONTEXT_MODE`
  - Files: `src/index.ts`
  - Pre-commit: `npm test`

- [x] 8. McpDependencies + 4 Agent Surface Updates

  **What to do**:
  - Change `McpDependencies.vaultScope?: string` to `McpDependencies.getVaultScope: () => string` (provider pattern)
  - Update Surface 1 (serverOptions.instructions): call `composeInstructions(deps.getVaultScope())` — note: this is set once at server creation, acceptable staleness
  - Update Surface 2 (view tool description): use `deps.getVaultScope()` in template literal
  - Update Surface 3 (vault://overview resource): `VaultOverviewResourceComposer` uses `deps.getVaultScope()` for heading — already fresh since resource is read on-demand
  - Update Surface 4 (first-call priming): `_meta.vault_orientation.scope` uses `deps.getVaultScope()`
  - In composition root (Task 7 wiring): `getVaultScope` reads cached value from OverviewManager or falls back to default
  - Update `composeInstructions` to accept `string` (no change needed — already does)
  - Update all McpDependencies usages in tests

  **Must NOT do**:
  - Do NOT make surfaces 1/2/4 auto-refresh on live connections (accept staleness until reconnection)
  - Do NOT change the MCP protocol responses format
  - Do NOT remove the `vault://contract` resource

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Touches presentation layer + integration tests, moderate complexity
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Tasks 3, 4, 7)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Tasks 3, 4, 7

  **References**:

  **Pattern References**:
  - `src/presentation/mcp-tools.ts:40-45` — `McpDependencies` interface definition
  - `src/presentation/mcp-tools.ts:50-52` — Surface 1: serverOptions.instructions
  - `src/presentation/mcp-tools.ts:364` — Surface 2: view tool description
  - `src/presentation/mcp-tools.ts:69-73` — Surface 3: VaultOverviewResourceComposer instantiation
  - `src/presentation/mcp-tools.ts:484` — Surface 4: first-call priming
  - `src/use-cases/vault-resource-overview.ts` — Updated composer from Task 3

  **API/Type References**:
  - `src/use-cases/instructions-composer.ts` — `composeInstructions(vaultScope: string)` signature (unchanged)
  - `src/presentation/mcp-tools.test.ts` — Integration tests using InMemoryTransport

  **Acceptance Criteria**:
  - [ ] `npm test` → ALL tests pass
  - [ ] `npm run lint` → clean
  - [ ] McpDependencies interface uses `getVaultScope: () => string`
  - [ ] All 4 surfaces call `deps.getVaultScope()` instead of reading static `deps.vaultScope`
  - [ ] vault://overview no longer includes contract content (from Task 3)
  - [ ] vault://contract resource still returns raw contract.md

  **QA Scenarios**:

  ```
  Scenario: vault://overview resource returns overview + stats (no contract)
    Tool: Bash (npx vitest run)
    Steps:
      1. Create McpServer with test dependencies including getVaultScope provider
      2. Read vault://overview resource
      3. Assert contains overview body and stats
      4. Assert does NOT contain "Frontmatter Schema" or "Tag Conventions" (contract markers)
    Expected Result: Clean overview without contract content
    Evidence: .sisyphus/evidence/task-8-overview-resource.txt

  Scenario: vault://contract resource still works independently
    Tool: Bash (npx vitest run)
    Steps:
      1. Read vault://contract resource
      2. Assert contains contract.md content ("Frontmatter Schema", "Tag Conventions")
    Expected Result: Contract resource unaffected by refactor
    Evidence: .sisyphus/evidence/task-8-contract-resource.txt

  Scenario: getVaultScope provider pattern works
    Tool: Bash (npx vitest run)
    Steps:
      1. Create deps with getVaultScope returning "test research vault"
      2. Initialize MCP server
      3. Assert instructions contain "test research vault"
      4. Assert first-call priming _meta contains "test research vault"
    Expected Result: Dynamic provider feeds all surfaces
    Evidence: .sisyphus/evidence/task-8-scope-provider.txt
  ```

  **Commit**: YES
  - Message: `refactor(mcp): update McpDependencies and 4 agent surfaces`
  - Files: `src/presentation/mcp-tools.ts`, `src/presentation/mcp-tools.test.ts`, `src/use-cases/instructions-composer.ts`
  - Pre-commit: `npm test`

- [x] 9. README.md Documentation Update

  **What to do**:
  - Replace all `VAULT_CONTEXT` documentation with `VAULT_CONTEXT_MODE` documentation
  - Update the environment variables table: add `VAULT_CONTEXT_MODE` (auto|manual, default: auto)
  - Add deprecation notice for `VAULT_CONTEXT` (still accepted, logs warning, ignored)
  - Update "Making agents find your vault" section to explain auto vs manual mode
  - Explain auto-generation: what it scans, when it refreshes (after indexAll, after 5 file changes)
  - Explain manual mode: user edits `meta/overview.md` directly
  - Remove any references to `VAULT_CONTEXT` as the primary config method

  **Must NOT do**:
  - Do NOT remove `VAULT_CONTEXT` mention entirely (needs deprecation note)
  - Do NOT add unrelated documentation changes
  - Do NOT change formatting conventions of existing README

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Pure documentation task
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 10)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:

  **Pattern References**:
  - `README.md` — Current VAULT_CONTEXT documentation sections (env var table, "Making agents find your vault" section)

  **Acceptance Criteria**:
  - [ ] README.md contains `VAULT_CONTEXT_MODE` in env var table with correct default
  - [ ] README.md contains deprecation notice for `VAULT_CONTEXT`
  - [ ] README.md explains auto mode behavior (structural heuristics, event-driven refresh)
  - [ ] README.md explains manual mode behavior (user-authored overview.md)
  - [ ] No broken markdown (links, tables, code blocks)
  - [ ] `npm run lint` → clean (no TypeScript affected, but verify)

  **QA Scenarios**:

  ```
  Scenario: README accurately documents new env var
    Tool: Bash (grep)
    Steps:
      1. grep "VAULT_CONTEXT_MODE" README.md
      2. Assert at least 3 occurrences (table + explanation sections)
      3. grep "auto|manual" or "auto` | `manual" in README.md
      4. Assert default documented as "auto"
    Expected Result: New env var properly documented
    Evidence: .sisyphus/evidence/task-9-readme-env.txt

  Scenario: Deprecation documented
    Tool: Bash (grep)
    Steps:
      1. grep -i "deprecated" README.md
      2. Assert mentions VAULT_CONTEXT in deprecation context
    Expected Result: Clear deprecation notice present
    Evidence: .sisyphus/evidence/task-9-readme-deprecation.txt
  ```

  **Commit**: YES
  - Message: `docs(readme): update VAULT_CONTEXT → VAULT_CONTEXT_MODE docs`
  - Files: `README.md`
  - Pre-commit: `npm run lint`

- [x] 10. CLAUDE.md Documentation Update

  **What to do**:
  - Update the Environment Variables table in CLAUDE.md:
    - Add `VAULT_CONTEXT_MODE` row: default `auto`, description "Vault description mode: `auto` (structural heuristics) or `manual` (user-authored overview.md)"
    - Mark `VAULT_CONTEXT` as deprecated in its row (or remove and add deprecation note)
  - Update any mentions of `VAULT_CONTEXT` in the architecture description if present
  - Add brief mention of OverviewManager in the Key Subsystems section if appropriate

  **Must NOT do**:
  - Do NOT rewrite unrelated CLAUDE.md sections
  - Do NOT add excessive detail (CLAUDE.md is a reference, not a tutorial)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Tiny targeted change to a documentation file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 9)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:

  **Pattern References**:
  - `CLAUDE.md` — Environment Variables table (current format)

  **Acceptance Criteria**:
  - [ ] CLAUDE.md env var table contains `VAULT_CONTEXT_MODE` with correct description
  - [ ] `VAULT_CONTEXT` marked deprecated or removed with note
  - [ ] No broken markdown formatting

  **QA Scenarios**:

  ```
  Scenario: CLAUDE.md env table updated
    Tool: Bash (grep)
    Steps:
      1. grep "VAULT_CONTEXT_MODE" CLAUDE.md
      2. Assert present in table with "auto" as default
      3. grep -c "VAULT_CONTEXT" CLAUDE.md — verify old var is deprecated/noted
    Expected Result: Table reflects new config
    Evidence: .sisyphus/evidence/task-10-claude-md.txt
  ```

  **Commit**: YES
  - Message: `docs(claude): update env var table in CLAUDE.md`
  - Files: `CLAUDE.md`
  - Pre-commit: `npm run lint`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run lint` + `npm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify co-located test pattern followed.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (OverviewManager + VaultIndexer + composition root working together). Test edge cases: empty vault, invalid mode, VAULT_CONTEXT set. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task | Commit Message | Key Files | Pre-commit Check |
|------|---------------|-----------|-----------------|
| 1 | `refactor(indexer): add event fan-out and change counter` | vault-indexer.ts, vault-indexer.test.ts | `npx vitest run src/use-cases/vault-indexer.test.ts` |
| 2 | `feat(config): add VAULT_CONTEXT_MODE config module` | vault-context-config.ts, vault-context-config.test.ts | `npx vitest run src/use-cases/vault-context-config.test.ts` |
| 3 | `refactor(overview-resource): remove contract from vault://overview` | vault-resource-overview.ts, vault-resource-overview.test.ts | `npx vitest run src/use-cases/vault-resource-overview.test.ts` |
| 4 | `feat(overview): add OverviewManager with auto-generation` | overview-manager.ts, overview-manager.test.ts | `npx vitest run src/use-cases/overview-manager.test.ts` |
| 5 | `refactor(template): make overview-template mode-aware` | overview-template.ts, overview-template.test.ts | `npx vitest run src/use-cases/overview-template.test.ts` |
| 6 | `refactor(auto-init): add mode-awareness to VaultAutoInitService` | vault-auto-init.ts, vault-auto-init.test.ts | `npx vitest run src/use-cases/vault-auto-init.test.ts` |
| 7 | `refactor(index): rewire composition root for VAULT_CONTEXT_MODE` | index.ts | `npm test` |
| 8 | `refactor(mcp): update McpDependencies and 4 agent surfaces` | mcp-tools.ts, mcp-tools.test.ts | `npm test` |
| 9 | `docs(readme): update VAULT_CONTEXT → VAULT_CONTEXT_MODE docs` | README.md | `npm run lint` |
| 10 | `docs(claude): update env var table in CLAUDE.md` | CLAUDE.md | `npm run lint` |

---

## Success Criteria

### Verification Commands
```bash
npm run lint        # Expected: clean, no errors
npm test            # Expected: all tests pass (existing + ~20 new)
VAULT_CONTEXT_MODE=invalid node dist/index.js 2>&1 | head -5  # Expected: startup error
VAULT_CONTEXT=foo node dist/index.js 2>&1 | grep -i deprecat  # Expected: deprecation warning
```

### Final Checklist
- [ ] All "Must Have" requirements verified
- [ ] All "Must NOT Have" guardrails checked
- [ ] All existing tests still pass (regression-free)
- [ ] New tests cover: auto-gen, manual mode, deprecation, threshold, cascade guard
- [ ] README and CLAUDE.md accurately reflect new behavior
