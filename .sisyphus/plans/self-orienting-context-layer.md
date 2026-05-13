# Self-Orienting Context Layer for mcp-markdown-vault

## TL;DR

> **Quick Summary**: Add a self-orienting context layer so connected agents autonomously discover vault scope, structure, and conventions without explicit user prompting. Implemented via 6 coordinated protocol mechanisms (env var, auto-init files, MCP resources, instructions field, per-session priming, tool description).
> 
> **Deliverables**:
> - `VAULT_CONTEXT` env var with fallback chain for vault scope resolution
> - Auto-init of `meta/contract.md` and `meta/overview.md` on first startup
> - 3 MCP resources: `vault://overview`, `vault://contract`, `vault://stats`
> - `instructions` field in MCP InitializeResult with vault orientation
> - Per-session priming metadata on first `view` tool call
> - Updated `view` tool description with vault scope keywords
> - README documentation for all new features
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves + final verification
> **Critical Path**: Scope Resolution → Auto-Init → MCP Wiring → Integration Tests

---

## Context

### Original Request
Implement a self-orienting context layer enabling connected MCP agents to autonomously route relevant queries to the vault server. The spec defines 6 coordinated components delivering the same context through different protocol layers for graceful degradation across clients.

### Interview Summary
**Key Discussions**:
- **Test Strategy**: TDD (Red-Green-Refactor) — each task includes failing tests first, then implementation
- **Architecture**: Follow existing patterns — concrete use-case classes in `src/use-cases/`, no new domain interfaces needed
- **Auto-init**: Runs in composition root before serverFactory, idempotent, handles read-only FS gracefully
- **Resources**: Re-read files on each ReadResource call (reflect user edits without restart)
- **Priming**: firstViewCall flag in createMcpServer closure scope (per-session)

### Research Findings
- SDK v1.29.0 confirmed: `McpServer` constructor accepts `ServerOptions.instructions`
- `registerResource(name, uri, config, readCallback)` API available for static URIs
- No existing resources registered — this is the first use
- `VaultOverviewService.getOverview()` too slow for resources (stats all files) — need lightweight alternative
- `McpServer` constructor currently missing second arg (no `ServerOptions` passed)
- `FakeEmbedder` in tests missing `modelName` property

### Metis Review
**Identified Gaps** (addressed):
- McpServer version hardcoded "0.1.0" → will note but not fix (out of scope — separate concern)
- FakeEmbedder missing modelName → include fix in MCP wiring task
- Concurrent SSE auto-init race → catch NoteAlreadyExistsError in auto-init service
- VAULT_CONTEXT sanitization → sanitize for markdown injection in description/header, pass-through for contract template
- Resource caching → re-read files each call for contract/overview; stats uses indexer cache when available

---

## Work Objectives

### Core Objective
Enable connected MCP agents to autonomously discover and route queries to this vault server through every available protocol mechanism, degrading gracefully across clients with different MCP feature support.

### Concrete Deliverables
- `src/use-cases/contract-template.ts` — contract.md template generator
- `src/use-cases/overview-template.ts` — overview.md stub generator
- `src/use-cases/vault-scope.ts` — scope resolution with fallback chain
- `src/use-cases/instructions-composer.ts` — instructions string builder
- `src/use-cases/vault-stats.ts` — lightweight vault stats computation
- `src/use-cases/vault-auto-init.ts` — meta/ file auto-initialization
- `src/use-cases/vault-resource-overview.ts` — overview resource composer
- Modified `src/presentation/mcp-tools.ts` — resources, instructions, priming, description
- Modified `src/index.ts` — composition root wiring
- Updated `README.md` — documentation for new features

### Definition of Done
- [ ] `npm test` passes with all new + existing tests green
- [ ] `npm run lint` passes (tsc --noEmit)
- [ ] Fresh vault startup creates `meta/contract.md` and `meta/overview.md`
- [ ] `client.listResources()` returns 3 resources
- [ ] `client.readResource({uri: "vault://overview"})` returns composed markdown
- [ ] MCP InitializeResult includes non-empty `instructions` field
- [ ] First `view` call returns `_meta.vault_orientation`; second does not

### Must Have
- All 6 components from the spec implemented and tested
- Backward compatibility — existing tool behavior unchanged
- TDD approach — tests written before implementation for each use-case
- Per-session isolation of priming state (especially SSE mode)
- Graceful handling of read-only vaults (warn, don't crash)
- VAULT_CONTEXT sanitization for markdown injection

### Must NOT Have (Guardrails)
- Must NOT modify `wrapTool()` function — priming goes inside view tool handler
- Must NOT call `VaultOverviewService.getOverview()` in resource callbacks
- Must NOT auto-init files with `overwrite=true` — only create if missing
- Must NOT modify tool descriptions for vault, edit, workflow, or system tools
- Must NOT add state to shared deps — per-session state stays in closure
- Must NOT add new MCP tools or env vars beyond VAULT_CONTEXT
- Must NOT add domain interfaces for new use-cases (follow concrete class pattern)
- Must NOT modify existing test assertions — only add `modelName` to FakeEmbedder
- Must NOT use `VaultOverviewService` for resource stat computation
- Must NOT add file watchers on `meta/` directory
- Must NOT implement hot-reload of instructions on contract.md edit

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest configured, 318 tests across 31 files)
- **Automated tests**: TDD (Red-Green-Refactor)
- **Framework**: vitest (`npx vitest run`)
- **Each task**: Write failing test → implement → verify pass → refactor

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Use-case modules**: Use Bash (`npx vitest run src/use-cases/{file}.test.ts`) — run tests, verify output
- **Integration (MCP)**: Use Bash (`npx vitest run src/presentation/mcp-tools.test.ts`) — InMemoryTransport tests
- **Full build**: Use Bash (`npm run lint && npm test`) — type-check + full test suite

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation use-cases, all independent):
├── Task 1: Contract template generator [quick]
├── Task 2: Overview stub generator [quick]
├── Task 3: Scope resolution use-case [quick]
├── Task 4: Instructions composer [quick]
└── Task 5: Vault stats composer [quick]

Wave 2 (After Wave 1 — composite use-cases):
├── Task 6: Auto-init service (depends: 1, 2) [deep]
└── Task 7: Overview resource composer (depends: 3, 5) [unspecified-high]

Wave 3 (After Wave 2 — presentation wiring):
├── Task 8: MCP server wiring (depends: 3, 4, 5, 7) [deep]
└── Task 9: Composition root wiring (depends: 3, 4, 6) [deep]

Wave 4 (After Wave 3 — documentation):
└── Task 10: README update (depends: all) [writing]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay

Critical Path: Task 3 → Task 7 → Task 8 → Task 9 → Task 10 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 6 | 1 |
| 2 | — | 6 | 1 |
| 3 | — | 6, 7, 8, 9 | 1 |
| 4 | — | 8, 9 | 1 |
| 5 | — | 7, 8 | 1 |
| 6 | 1, 2 | 9 | 2 |
| 7 | 3, 5 | 8 | 2 |
| 8 | 3, 4, 5, 7 | 10 | 3 |
| 9 | 3, 4, 6 | 10 | 3 |
| 10 | 8, 9 | — | 4 |

### Agent Dispatch Summary

- **Wave 1**: **5** — T1→`quick`, T2→`quick`, T3→`quick`, T4→`quick`, T5→`quick`
- **Wave 2**: **2** — T6→`deep`, T7→`unspecified-high`
- **Wave 3**: **2** — T8→`deep`, T9→`deep`
- **Wave 4**: **1** — T10→`writing`
- **FINAL**: **4** — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

- [x] 1. Contract Template Generator (TDD)

  **What to do**:
  - RED: Write tests for `generateContractTemplate(vaultContext: string, timestamp: string): string`
    - Test: output contains frontmatter with `schema_version: 1`, `generated_by: mcp-markdown-vault`, `generated_at` matching timestamp
    - Test: output contains `# Vault Navigation Contract` heading
    - Test: output contains all 7 required sections: Scope, Directory Layout, Frontmatter Schema, Tag Conventions, Search Hints, Naming Conventions, Workflow States
    - Test: `## Scope` section contains the provided `vaultContext` value
    - Test: with default/empty vaultContext, `## Scope` contains `"general markdown notes vault"`
    - Test: HTML comments (inline guidance) are present in output
    - Test: `## Search Hints` contains the 4 canned search action recommendations
  - GREEN: Implement `generateContractTemplate()` as a pure function
  - REFACTOR: Extract template sections if function exceeds 80 lines

  **Must NOT do**:
  - Must NOT perform any I/O (no fs reads/writes)
  - Must NOT import any infrastructure modules
  - Must NOT sanitize `vaultContext` input (pass-through for contract template per spec)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure function, single file, well-defined output — straightforward template assembly
  - **Skills**: []
    - No special skills needed — this is plain TypeScript string generation
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 6 (Auto-init service needs this template)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/create-from-template.ts` — Follow this use-case file pattern: single exported function/class, DTO types co-located, vitest co-located test
  - `src/infrastructure/regex-template-engine.ts` — Example of template-related code in the project (but this task is simpler — pure string assembly)

  **API/Type References**:
  - None — this is a standalone pure function with no external dependencies

  **Test References**:
  - `src/use-cases/create-from-template.test.ts` — Co-located test pattern to follow (vitest, describe/it structure)
  - `src/domain/errors/domain-errors.test.ts` — Simple unit test pattern with no mocking

  **External References**:
  - Implementation spec Component 2 template (in user's original request) — The EXACT template content to generate

  **WHY Each Reference Matters**:
  - `create-from-template.ts`: Shows the project's convention for file structure in use-cases layer
  - Implementation spec: Contains the exact template text that this function must produce (headers, comments, search hints)

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/contract-template.test.ts`
  - [ ] `npx vitest run src/use-cases/contract-template.test.ts` → PASS (7+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/contract-template.ts`

  **QA Scenarios:**

  ```
  Scenario: Generate contract template with custom vault context
    Tool: Bash (npx vitest run)
    Preconditions: Test file exists with assertions
    Steps:
      1. Run `npx vitest run src/use-cases/contract-template.test.ts`
      2. Verify exit code 0
      3. Verify output contains "Tests  7 passed" (or more)
    Expected Result: All tests pass, exit code 0
    Failure Indicators: Non-zero exit code, "FAIL" in output, test count mismatch
    Evidence: .sisyphus/evidence/task-1-contract-template-tests.txt

  Scenario: Verify template structure manually
    Tool: Bash (node --eval)
    Preconditions: Implementation file compiled successfully
    Steps:
      1. Run `npx tsx -e "import {generateContractTemplate} from './src/use-cases/contract-template.ts'; const t = generateContractTemplate('my AI research notes', '2025-01-01T00:00:00Z'); console.log(t.includes('## Scope')); console.log(t.includes('my AI research notes')); console.log(t.includes('schema_version: 1'));"`
      2. Assert all three lines output `true`
    Expected Result: Three `true` values printed to stdout
    Failure Indicators: Any `false` output, import error, or runtime exception
    Evidence: .sisyphus/evidence/task-1-contract-template-manual.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(context): add contract template generator`
  - Files: `src/use-cases/contract-template.ts`, `src/use-cases/contract-template.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/contract-template.test.ts`

- [x] 2. Overview Stub Generator (TDD)

  **What to do**:
  - RED: Write tests for `generateOverviewStub(timestamp: string): string`
    - Test: output contains frontmatter with `schema_version: 1`, `generated_by: mcp-markdown-vault`, `generated_at` matching timestamp, `managed_by: user`
    - Test: output contains `# Vault Overview` heading
    - Test: output contains the instructional HTML comment about user-controlled content
    - Test: output body (after frontmatter + comment) is empty/minimal
    - Test: output is valid markdown (no unclosed fences, valid frontmatter delimiters)
  - GREEN: Implement `generateOverviewStub()` as a pure function
  - REFACTOR: Ensure consistent formatting with contract template

  **Must NOT do**:
  - Must NOT perform any I/O
  - Must NOT include vault-specific content (this is a blank stub for user to fill)
  - Must NOT add any content beyond what the spec defines

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Trivial pure function — generates a short static template string
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Task 6 (Auto-init service needs this template)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/contract-template.ts` (Task 1 output) — Same pattern: pure function, co-located test
  - `src/use-cases/create-from-template.ts` — Use-case file structure convention

  **Test References**:
  - `src/use-cases/contract-template.test.ts` (Task 1 output) — Mirror test structure

  **External References**:
  - Implementation spec Component 3 template — The EXACT stub content to generate

  **WHY Each Reference Matters**:
  - Spec template: Contains the exact output format (frontmatter fields, heading, comment text)
  - Task 1 pattern: Ensures consistency between the two template generators

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/overview-template.test.ts`
  - [ ] `npx vitest run src/use-cases/overview-template.test.ts` → PASS (5+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/overview-template.ts`

  **QA Scenarios:**

  ```
  Scenario: Generate overview stub with timestamp
    Tool: Bash (npx vitest run)
    Preconditions: Test file exists
    Steps:
      1. Run `npx vitest run src/use-cases/overview-template.test.ts`
      2. Verify exit code 0
      3. Verify all tests pass
    Expected Result: All tests pass, exit code 0
    Failure Indicators: Non-zero exit code, any FAIL line in output
    Evidence: .sisyphus/evidence/task-2-overview-template-tests.txt

  Scenario: Verify stub is minimal (mostly empty body)
    Tool: Bash (npx tsx)
    Preconditions: Implementation compiled
    Steps:
      1. Run `npx tsx -e "import {generateOverviewStub} from './src/use-cases/overview-template.ts'; const s = generateOverviewStub('2025-01-01T00:00:00Z'); const lines = s.split('\n').filter(l => l.trim() && !l.startsWith('---') && !l.startsWith('#') && !l.startsWith('<!--') && !l.startsWith(' ') && !l.includes(':')); console.log('non-structural lines:', lines.length);"`
      2. Assert `non-structural lines: 0` (body is empty beyond structure)
    Expected Result: Zero non-structural content lines
    Failure Indicators: Count > 0 indicating unexpected content in stub
    Evidence: .sisyphus/evidence/task-2-overview-stub-minimal.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(context): add overview stub generator`
  - Files: `src/use-cases/overview-template.ts`, `src/use-cases/overview-template.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/overview-template.test.ts`

- [x] 3. Scope Resolution Use-Case (TDD)

  **What to do**:
  - RED: Write tests for `VaultScopeResolver` class:
    - Constructor accepts `{ fsAdapter: IFileSystemAdapter, vaultContext?: string }`
    - Method `resolveScope(): Promise<string>` implements fallback chain:
      1. Read `meta/contract.md`, parse `## Scope` section content → return if non-empty
      2. Use `vaultContext` constructor param → return if non-empty (not just whitespace)
      3. Return hardcoded default `"general markdown notes vault"`
    - Test: contract.md exists with `## Scope` content → returns that content
    - Test: contract.md exists but `## Scope` is empty/missing → falls back to vaultContext param
    - Test: contract.md missing entirely → falls back to vaultContext param
    - Test: vaultContext is `undefined` → falls back to default
    - Test: vaultContext is `""` (empty string) → falls back to default
    - Test: vaultContext is `"  "` (whitespace only) → falls back to default
    - Test: contract.md has malformed frontmatter but valid `## Scope` → still extracts scope
    - Test: contract.md `## Scope` section has multi-line content → returns full content trimmed
  - GREEN: Implement `VaultScopeResolver` using `fsAdapter.readNote()` + simple markdown heading extraction (regex or existing AST pipeline)
  - REFACTOR: Extract heading-section-extraction into a helper if reusable

  **Must NOT do**:
  - Must NOT use `VaultOverviewService` — implement lightweight section extraction
  - Must NOT cache result (caller decides caching strategy)
  - Must NOT throw on missing contract.md — graceful fallback
  - Must NOT import from infrastructure layer

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single use-case class with clear I/O boundary, well-defined fallback logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Tasks 6, 7, 8, 9 (scope is needed by most downstream tasks)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/read-by-heading.ts` — Shows how to extract content under a specific heading using AST. The scope resolver needs similar logic but can use simpler regex since contract.md is a controlled format
  - `src/use-cases/fragment-retrieval.ts` — Example use-case class pattern with dependency injection via constructor

  **API/Type References**:
  - `src/domain/interfaces/file-system-adapter.ts:IFileSystemAdapter` — The `readNote(path: string): Promise<string>` and `exists(path: string): Promise<boolean>` methods needed
  - `src/domain/errors/index.ts:NoteNotFoundError` — Thrown by `readNote` when file missing — must catch this

  **Test References**:
  - `src/use-cases/read-by-heading.test.ts` — Tests that use real temp directories and IFileSystemAdapter for file-dependent use-cases
  - `src/infrastructure/local-file-system-adapter.test.ts` — Shows how to set up temp dir + LocalFileSystemAdapter for testing

  **External References**:
  - Implementation spec Component 1: "Resolution priority for vault scope string" — The exact fallback chain to implement

  **WHY Each Reference Matters**:
  - `read-by-heading.ts`: Shows the project's approach to heading-based content extraction — but for a controlled file like contract.md, regex is simpler and avoids AST pipeline overhead
  - `IFileSystemAdapter`: This is the ONLY I/O dependency — constructor injection, catch NoteNotFoundError for graceful fallback
  - Spec Component 1: Defines the exact 3-step fallback priority that this use-case must implement

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/vault-scope.test.ts`
  - [ ] `npx vitest run src/use-cases/vault-scope.test.ts` → PASS (8+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/vault-scope.ts`

  **QA Scenarios:**

  ```
  Scenario: Full fallback chain with real filesystem
    Tool: Bash (npx vitest run)
    Preconditions: Test file with temp dir setup
    Steps:
      1. Run `npx vitest run src/use-cases/vault-scope.test.ts`
      2. Verify exit code 0
      3. Verify 8+ tests pass
    Expected Result: All fallback scenarios verified, exit code 0
    Failure Indicators: Non-zero exit, FAIL output, fewer than 8 tests
    Evidence: .sisyphus/evidence/task-3-vault-scope-tests.txt

  Scenario: Scope resolution with malformed contract.md
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Tests include malformed frontmatter scenario
    Steps:
      1. Run `npx vitest run src/use-cases/vault-scope.test.ts --reporter=verbose`
      2. Find test name containing "malformed" in output
      3. Verify it shows ✓ (passed)
    Expected Result: Malformed contract.md test passes (graceful fallback, no crash)
    Failure Indicators: Test missing or showing ✗ (failed)
    Evidence: .sisyphus/evidence/task-3-vault-scope-malformed.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(context): add vault scope resolution with fallback chain`
  - Files: `src/use-cases/vault-scope.ts`, `src/use-cases/vault-scope.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-scope.test.ts`

- [x] 4. Instructions Composer (TDD)

  **What to do**:
  - RED: Write tests for `composeInstructions(vaultScope: string): string`
    - Test: output starts with "Headless markdown vault MCP server."
    - Test: output contains `Vault scope: <provided vaultScope>`
    - Test: output lists all 5 tool dispatchers (view, vault, edit, workflow, system) with their actions
    - Test: output includes search guidance sentence (semantic_search for conceptual, global_search for exact)
    - Test: output mentions `vault://overview` resource
    - Test: output is under 2048 characters (reasonable limit for instructions field)
    - Test: with very long vaultScope (500+ chars), output is truncated/capped at safe length
    - Test: vaultScope containing markdown special chars (backticks, brackets) is sanitized in output
  - GREEN: Implement `composeInstructions()` as a pure function that assembles the instructions string per spec Component 5
  - REFACTOR: Extract constants for tool descriptions if they aid readability

  **Must NOT do**:
  - Must NOT perform any I/O
  - Must NOT include imperative directives like "AGENT MUST call X first"
  - Must NOT exceed reasonable length (cap at 2048 chars)
  - Must NOT include version numbers or timestamps (stale-data risk)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure string composition function — no I/O, no dependencies, well-defined output per spec
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Tasks 8, 9 (instructions string needed for MCP wiring)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/contract-template.ts` (Task 1 output) — Same pattern: pure function generating a structured string

  **API/Type References**:
  - None — standalone pure function

  **External References**:
  - Implementation spec Component 5: "Composition" section — The EXACT format and content for instructions string
  - MCP SDK `ServerOptions.instructions` — String field, no format constraints beyond being text

  **WHY Each Reference Matters**:
  - Spec Component 5: Defines the exact text structure including tool dispatcher summary and search guidance
  - The function must produce THIS exact content (with scope interpolation)

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/instructions-composer.test.ts`
  - [ ] `npx vitest run src/use-cases/instructions-composer.test.ts` → PASS (8+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/instructions-composer.ts`

  **QA Scenarios:**

  ```
  Scenario: Instructions composition with standard scope
    Tool: Bash (npx vitest run)
    Preconditions: Test file exists
    Steps:
      1. Run `npx vitest run src/use-cases/instructions-composer.test.ts`
      2. Verify exit code 0
      3. Verify all tests pass
    Expected Result: All tests pass, exit code 0
    Failure Indicators: Non-zero exit code, FAIL in output
    Evidence: .sisyphus/evidence/task-4-instructions-composer-tests.txt

  Scenario: Verify instructions contain all required tool dispatchers
    Tool: Bash (npx tsx)
    Preconditions: Implementation compiled
    Steps:
      1. Run `npx tsx -e "import {composeInstructions} from './src/use-cases/instructions-composer.ts'; const i = composeInstructions('my research vault'); const tools = ['view', 'vault', 'edit', 'workflow', 'system']; const missing = tools.filter(t => !i.includes(t)); console.log('missing tools:', missing.length === 0 ? 'none' : missing.join(', ')); console.log('length:', i.length, i.length <= 2048 ? '(OK)' : '(TOO LONG)');"`
      2. Assert "missing tools: none" and length shows "(OK)"
    Expected Result: All 5 tools present, length under 2048
    Failure Indicators: Any missing tool name, or length exceeding limit
    Evidence: .sisyphus/evidence/task-4-instructions-verify.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(context): add instructions composer`
  - Files: `src/use-cases/instructions-composer.ts`, `src/use-cases/instructions-composer.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/instructions-composer.test.ts`

- [x] 5. Vault Stats Composer (TDD)

  **What to do**:
  - RED: Write tests for `VaultStatsComposer` class:
    - Constructor accepts `{ fsAdapter: IFileSystemAdapter, indexer?: VaultIndexer, embedder: IEmbeddingProvider }`
    - Method `computeStats(): Promise<VaultStats>` returns:
      ```typescript
      type VaultStats = {
        fileCount: number;
        topDirectories: Array<{ name: string; fileCount: number }>;
        indexStatus: 'ready' | 'building' | 'not started';
        embeddingProvider: string;
        indexedAt?: string;
      };
      ```
    - Test: empty vault → `fileCount: 0`, `topDirectories: []`
    - Test: vault with files in root → counts correctly, no directory entries for root files
    - Test: vault with subdirectories → `topDirectories` has entries with correct counts
    - Test: `meta/` directory excluded from fileCount and topDirectories
    - Test: `topDirectories` limited to max 10 entries, sorted by file count descending
    - Test: indexer not provided → `indexStatus: 'not started'`, no `indexedAt`
    - Test: indexer healthy → `indexStatus: 'ready'`, `indexedAt` populated
    - Test: indexer indexing → `indexStatus: 'building'`
    - Test: embedder.modelName reflected in `embeddingProvider` field
  - GREEN: Implement using `fsAdapter.listNotes()` for file listing + path parsing for directory grouping + `indexer?.getHealthStatus()` for index state
  - REFACTOR: Optimize directory grouping (single pass over file list)

  **Must NOT do**:
  - Must NOT call `stat()` on individual files (performance constraint)
  - Must NOT use `VaultOverviewService.getOverview()`
  - Must NOT perform recursive directory reads — use `listNotes()` which returns all paths
  - Must NOT include `meta/` files in counts or directory listing

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single use-case class with clear inputs/outputs, simple path parsing logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Tasks 7, 8 (stats used by overview resource and vault://stats resource)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/use-cases/vault-overview.ts:VaultOverviewService` — Reference for WHAT data is needed but NOT how to compute it (this service is too slow). Study its output shape to understand expectations, then implement lightweight alternative using only `listNotes()` + path parsing
  - `src/use-cases/fragment-retrieval.ts` — Use-case class pattern with constructor DI

  **API/Type References**:
  - `src/domain/interfaces/file-system-adapter.ts:IFileSystemAdapter.listNotes(dir?: string)` — Returns `Promise<string[]>` of vault-relative paths. Call with no args to get ALL notes
  - `src/use-cases/vault-indexer.ts:VaultIndexer.getHealthStatus()` — Returns `IndexingHealthStatus` with `indexingState: 'idle' | 'indexing' | 'error'`, `indexedDocuments: number`
  - `src/domain/interfaces/embedding-provider.ts:IEmbeddingProvider.modelName` — String property identifying the embedding model

  **Test References**:
  - `src/use-cases/vault-overview.test.ts` — Shows temp dir setup with subdirectories and files for testing vault structure queries
  - `src/infrastructure/local-file-system-adapter.test.ts` — LocalFileSystemAdapter test setup pattern

  **External References**:
  - Implementation spec Component 4 `vault://stats` schema — The exact JSON shape that `VaultStats` must match

  **WHY Each Reference Matters**:
  - `VaultOverviewService`: Shows what data consumers expect (file counts, directory structure) but we MUST NOT call it — implement lighter using listNotes only
  - `IFileSystemAdapter.listNotes()`: Returns all paths as strings — parse directory from path to group by top-level dir
  - `VaultIndexer.getHealthStatus()`: Maps to `indexStatus` field — 'idle' → 'ready', 'indexing' → 'building', undefined → 'not started'
  - Spec schema: The exact output contract for vault://stats resource

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/vault-stats.test.ts`
  - [ ] `npx vitest run src/use-cases/vault-stats.test.ts` → PASS (9+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/vault-stats.ts`
  - [ ] Type exported: `VaultStats`

  **QA Scenarios:**

  ```
  Scenario: Stats computation with populated vault
    Tool: Bash (npx vitest run)
    Preconditions: Test file with temp dir containing subdirectories and files
    Steps:
      1. Run `npx vitest run src/use-cases/vault-stats.test.ts`
      2. Verify exit code 0
      3. Verify 9+ tests pass
    Expected Result: All tests pass, exit code 0
    Failure Indicators: Non-zero exit, FAIL output, missing test scenarios
    Evidence: .sisyphus/evidence/task-5-vault-stats-tests.txt

  Scenario: Verify meta/ exclusion
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Test includes meta/ exclusion scenario
    Steps:
      1. Run `npx vitest run src/use-cases/vault-stats.test.ts --reporter=verbose`
      2. Find test containing "meta" or "exclude" in name
      3. Verify it shows ✓ (passed)
    Expected Result: meta/ exclusion test passes
    Failure Indicators: Test missing or failed
    Evidence: .sisyphus/evidence/task-5-vault-stats-meta-exclusion.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(context): add vault stats composer`
  - Files: `src/use-cases/vault-stats.ts`, `src/use-cases/vault-stats.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-stats.test.ts`

- [x] 6. Auto-Init Service (TDD)

  **What to do**:
  - RED: Write tests for `VaultAutoInitService` class:
    - Constructor accepts `{ fsAdapter: IFileSystemAdapter, vaultContext: string }`
    - Method `initialize(): Promise<AutoInitResult>` where:
      ```typescript
      type AutoInitResult = {
        contractCreated: boolean;
        overviewCreated: boolean;
        warnings: string[];
      };
      ```
    - Test: empty vault (no files) → creates both `meta/contract.md` and `meta/overview.md`, returns `{ contractCreated: true, overviewCreated: true, warnings: [] }`
    - Test: vault with existing .md files but no `meta/contract.md` → creates contract, `warnings` contains the recommended warn-level message about non-empty vault
    - Test: `meta/contract.md` already exists → does NOT overwrite, `contractCreated: false`
    - Test: `meta/overview.md` already exists → does NOT overwrite, `overviewCreated: false`
    - Test: both already exist → neither created, both false, no warnings
    - Test: only contract exists, overview missing → creates overview only
    - Test: only overview exists, contract missing → creates contract only
    - Test: creates `meta/` directory if it doesn't exist
    - Test: generated contract contains VAULT_CONTEXT value in Scope section
    - Test: generated overview contains valid frontmatter with `managed_by: user`
    - Test: concurrent calls (simulate race) → second call gets `created: false` (idempotent), no error thrown
    - Test: read-only filesystem → returns `{ contractCreated: false, overviewCreated: false, warnings: ["...read-only..."] }` — does NOT throw
  - GREEN: Implement using `fsAdapter.exists()` + `generateContractTemplate()` + `generateOverviewStub()` + `fsAdapter.writeNote()`
  - REFACTOR: Ensure error handling is clean (catch specific errors, not generic)

  **Must NOT do**:
  - Must NOT use `overwrite=true` when calling `writeNote` — use `exists()` guard
  - Must NOT throw errors for expected conditions (read-only, already exists)
  - Must NOT read vault files to determine "non-empty vault" — use `listNotes()` and check length
  - Must NOT modify existing files under any circumstance

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Orchestrates multiple I/O operations with error handling, race condition handling, and multiple code paths — needs careful implementation
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 7)
  - **Blocks**: Task 9 (composition root needs auto-init)
  - **Blocked By**: Tasks 1, 2 (needs template generators)

  **References**:

  **Pattern References**:
  - `src/use-cases/create-from-template.ts:CreateFromTemplateUseCase` — Similar pattern: check exists → generate content → write. Shows idempotent creation with `NoteAlreadyExistsError` handling
  - `src/use-cases/update-file.ts` — Shows `fsAdapter.writeNote()` usage with overwrite semantics

  **API/Type References**:
  - `src/domain/interfaces/file-system-adapter.ts:IFileSystemAdapter` — `exists(path)`, `writeNote(path, content, overwrite?)`, `listNotes(dir?)`
  - `src/domain/errors/index.ts:NoteAlreadyExistsError` — Thrown by `writeNote` when file exists and `overwrite=false`
  - `src/use-cases/contract-template.ts:generateContractTemplate` (Task 1) — Template content source
  - `src/use-cases/overview-template.ts:generateOverviewStub` (Task 2) — Stub content source

  **Test References**:
  - `src/use-cases/create-from-template.test.ts` — Shows testing file creation with real temp dirs, including exists-check scenarios
  - `src/infrastructure/local-file-system-adapter.test.ts` — Setup pattern for LocalFileSystemAdapter with writable temp dirs

  **External References**:
  - Implementation spec Component 2 "Behavior" section — The exact init logic and logging requirements
  - Implementation spec Component 3 "Behavior" section — Overview stub creation rules
  - Implementation spec "Edge cases" #3 — Read-only filesystem graceful handling

  **WHY Each Reference Matters**:
  - `CreateFromTemplateUseCase`: Shows the EXACT pattern for "create if not exists" with proper error handling — follow this closely
  - `NoteAlreadyExistsError`: CATCH this error for concurrent race condition — if `writeNote` throws it after our `exists()` check passed, treat as "already created" (idempotent)
  - Spec Behavior sections: Define the exact conditions for info vs warn logging and what triggers each code path

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/vault-auto-init.test.ts`
  - [ ] `npx vitest run src/use-cases/vault-auto-init.test.ts` → PASS (12+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/vault-auto-init.ts`
  - [ ] Type exported: `AutoInitResult`

  **QA Scenarios:**

  ```
  Scenario: Auto-init on empty vault creates both files
    Tool: Bash (npx vitest run)
    Preconditions: Test file with empty temp dir scenario
    Steps:
      1. Run `npx vitest run src/use-cases/vault-auto-init.test.ts`
      2. Verify exit code 0
      3. Verify 12+ tests pass
    Expected Result: All scenarios covered and passing
    Failure Indicators: Non-zero exit, FAIL output, fewer than 12 tests
    Evidence: .sisyphus/evidence/task-6-auto-init-tests.txt

  Scenario: Idempotency — running twice doesn't corrupt
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Tests include idempotency/concurrent scenario
    Steps:
      1. Run `npx vitest run src/use-cases/vault-auto-init.test.ts --reporter=verbose`
      2. Find test containing "concurrent" or "idempotent" or "already exists"
      3. Verify it shows ✓ (passed)
    Expected Result: Idempotency test passes
    Failure Indicators: Test throws error instead of graceful handling
    Evidence: .sisyphus/evidence/task-6-auto-init-idempotent.txt

  Scenario: Read-only filesystem graceful handling
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Tests include read-only scenario
    Steps:
      1. Run `npx vitest run src/use-cases/vault-auto-init.test.ts --reporter=verbose`
      2. Find test containing "read-only" or "readonly"
      3. Verify it shows ✓ (passed) — no throw, warning in result
    Expected Result: Graceful degradation, warning in result, no exception
    Failure Indicators: Unhandled exception or missing warning
    Evidence: .sisyphus/evidence/task-6-auto-init-readonly.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(context): add vault auto-init service`
  - Files: `src/use-cases/vault-auto-init.ts`, `src/use-cases/vault-auto-init.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-auto-init.test.ts`

- [x] 7. Overview Resource Composer (TDD)

  **What to do**:
  - RED: Write tests for `VaultOverviewResourceComposer` class:
    - Constructor accepts `{ fsAdapter: IFileSystemAdapter, statsComposer: VaultStatsComposer, vaultScope: string }`
    - Method `compose(): Promise<string>` returns full `vault://overview` resource content
    - Composition order:
      1. Header: `# Vault: <vaultScope>`
      2. `## Quick Stats` section with live values from statsComposer
      3. Full content of `meta/contract.md` (if exists)
      4. Full content of `meta/overview.md` body (if exists AND body non-empty after stripping frontmatter + HTML comments)
    - Test: vault with contract + overview + stats → full composed document with all 4 sections
    - Test: contract.md missing → stats section still present, contract section omitted
    - Test: overview.md missing → composed without overview section
    - Test: overview.md exists but body is only comments/frontmatter → overview section omitted
    - Test: overview.md has actual content → included after stripping frontmatter
    - Test: header uses provided vaultScope
    - Test: stats section formats fileCount, topDirectories, indexStatus, embeddingProvider as readable markdown
    - Test: special characters in vaultScope are sanitized in header (backticks, brackets escaped)
  - GREEN: Implement composer reading files via `fsAdapter.readNote()`, catching `NoteNotFoundError`, stripping frontmatter from overview body
  - REFACTOR: Extract frontmatter-stripping logic into helper function

  **Must NOT do**:
  - Must NOT cache file contents (re-read on each compose() call to reflect user edits)
  - Must NOT call `VaultOverviewService.getOverview()`
  - Must NOT include empty sections (skip overview section entirely if body empty)
  - Must NOT crash on missing files — graceful omission

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple I/O operations, content composition with conditional sections, frontmatter parsing — non-trivial but not architecturally complex
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 6)
  - **Blocks**: Task 8 (MCP server registers this as vault://overview handler)
  - **Blocked By**: Tasks 3, 5 (needs scope resolver pattern + stats composer)

  **References**:

  **Pattern References**:
  - `src/use-cases/read-by-heading.ts` — Shows reading file content and extracting sections
  - `src/use-cases/bulk-read.ts` — Shows reading multiple files with per-item fault tolerance (catch + continue pattern)

  **API/Type References**:
  - `src/use-cases/vault-stats.ts:VaultStatsComposer` (Task 5) — `computeStats(): Promise<VaultStats>` for stats section
  - `src/domain/interfaces/file-system-adapter.ts:IFileSystemAdapter` — `readNote(path)` for reading contract.md and overview.md
  - `src/domain/errors/index.ts:NoteNotFoundError` — Catch to handle missing files gracefully

  **Test References**:
  - `src/use-cases/bulk-read.test.ts` — Shows testing with temp dirs containing multiple files, testing missing-file fallbacks

  **External References**:
  - Implementation spec Component 4 `vault://overview` section — The exact composition order and rules for inclusion/exclusion

  **WHY Each Reference Matters**:
  - `bulk-read.ts`: The per-item fault tolerance pattern (try/catch around each file read, continue on error) is exactly what's needed here
  - Spec Component 4: Defines composition ORDER (header → stats → contract → overview) and exclusion rules (overview body must be non-empty after stripping)
  - `VaultStats` type: Format stats section as readable markdown table or bullet list from this structured data

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/use-cases/vault-resource-overview.test.ts`
  - [ ] `npx vitest run src/use-cases/vault-resource-overview.test.ts` → PASS (8+ tests, 0 failures)
  - [ ] Implementation file: `src/use-cases/vault-resource-overview.ts`

  **QA Scenarios:**

  ```
  Scenario: Full composition with all sections present
    Tool: Bash (npx vitest run)
    Preconditions: Test file with temp dir containing contract.md and overview.md
    Steps:
      1. Run `npx vitest run src/use-cases/vault-resource-overview.test.ts`
      2. Verify exit code 0
      3. Verify 8+ tests pass
    Expected Result: All composition scenarios verified
    Failure Indicators: Non-zero exit, FAIL output, missing scenarios
    Evidence: .sisyphus/evidence/task-7-resource-overview-tests.txt

  Scenario: Graceful handling of missing files
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Tests include missing-file scenarios
    Steps:
      1. Run `npx vitest run src/use-cases/vault-resource-overview.test.ts --reporter=verbose`
      2. Find tests containing "missing" in name
      3. Verify all show ✓ (passed)
    Expected Result: Missing file tests pass without exceptions
    Failure Indicators: Unhandled NoteNotFoundError propagating
    Evidence: .sisyphus/evidence/task-7-resource-overview-missing.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(context): add overview resource composer`
  - Files: `src/use-cases/vault-resource-overview.ts`, `src/use-cases/vault-resource-overview.test.ts`
  - Pre-commit: `npx vitest run src/use-cases/vault-resource-overview.test.ts`

- [x] 8. MCP Server Wiring — Resources, Instructions, Priming (TDD)

  **What to do**:
  - RED: Write integration tests in `src/presentation/mcp-tools.test.ts` (extend existing file):
    - Test: `client.listResources()` returns 3 resources with URIs `vault://overview`, `vault://contract`, `vault://stats`
    - Test: `client.readResource({ uri: "vault://overview" })` returns markdown string starting with `# Vault:`
    - Test: `client.readResource({ uri: "vault://contract" })` returns raw contract.md content
    - Test: `client.readResource({ uri: "vault://stats" })` returns valid JSON matching `VaultStats` schema
    - Test: `vault://contract` when contract.md missing → returns error (not crash)
    - Test: `vault://overview` when no meta/ files exist → returns degraded overview (header + stats only)
    - Test: First `view` tool call returns `_meta.vault_orientation` with scope, topDirectories, hint
    - Test: Second `view` tool call does NOT contain `_meta.vault_orientation`
    - Test: First `vault` tool call does NOT contain `_meta.vault_orientation` (only view primes)
    - Test: `instructions` field received during initialization contains vault scope and tool dispatchers
    - Test: `view` tool description includes vault scope text from `VAULT_CONTEXT`
  - GREEN: Modify `createMcpServer()` in `src/presentation/mcp-tools.ts`:
    1. Extend `McpDependencies` interface: add `instructions?: string`, `vaultScope?: string`
    2. Pass `{ instructions: deps.instructions }` as second arg to `new McpServer(serverInfo, options)`
    3. Register 3 MCP resources using `server.resource()`:
       - `vault://overview`: call `VaultOverviewResourceComposer.compose()`
       - `vault://contract`: read `meta/contract.md` via `fsAdapter.readNote()`
       - `vault://stats`: call `VaultStatsComposer.computeStats()` and return as JSON
    4. Add `firstViewCall = true` boolean in closure scope
    5. In view tool handler, before returning response: if `firstViewCall`, augment response with `_meta.vault_orientation`, set `firstViewCall = false`
    6. Update `view` tool description to include `deps.vaultScope` scope text
  - REFACTOR: Ensure resource callbacks handle errors gracefully (missing files → error response, not crash)

  **Must NOT do**:
  - Must NOT modify `wrapTool()` function — priming goes INSIDE the view tool handler, BEFORE wrapTool call
  - Must NOT add priming to any tool other than `view`
  - Must NOT change tool descriptions for `vault`, `edit`, `workflow`, or `system` tools
  - Must NOT cache resource content at registration time (recompute on each read)
  - Must NOT add `firstViewCall` to `McpDependencies` — it lives in the closure, per-server-instance
  - Must NOT break any of the 318 existing tests — only extend

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Touches the core presentation module, requires understanding of McpServer API (registerResource), closure-scoped state management, and careful integration with existing tool handlers. Architectural impact is high — wrong wiring breaks all tools.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 9)
  - **Blocks**: None (final wiring task for presentation layer)
  - **Blocked By**: Tasks 3, 4, 5, 7 (needs scope resolver, instructions composer, stats composer, overview resource composer)

  **References**:

  **Pattern References**:
  - `src/presentation/mcp-tools.ts:43-521` — The ENTIRE `createMcpServer()` function. Study the closure structure, how tools are registered via `server.tool()`, and how `wrapTool()` wraps responses. Resources are registered similarly but via `server.resource()`
  - `src/presentation/mcp-tools.ts:525-549` — `wrapTool()` helper. DO NOT MODIFY. Priming injection must happen BEFORE wrapTool is called in the view tool handler

  **API/Type References**:
  - `src/presentation/mcp-tools.ts:30-38` — `McpDependencies` interface to extend with `instructions?: string` and `vaultScope?: string`
  - `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `McpServer` constructor signature: `new McpServer(serverInfo: Implementation, options?: ServerOptions)` where `ServerOptions = { capabilities?, instructions? }`
  - `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `server.resource(name, uri, metadata, readCallback)` — register static resource
  - `src/use-cases/vault-scope.ts:VaultScopeResolver` (Task 3) — `resolve(): Promise<string>` for scope
  - `src/use-cases/instructions-composer.ts:composeInstructions` (Task 4) — `composeInstructions(vaultScope): string`
  - `src/use-cases/vault-stats.ts:VaultStatsComposer` (Task 5) — `computeStats(): Promise<VaultStats>`
  - `src/use-cases/vault-resource-overview.ts:VaultOverviewResourceComposer` (Task 7) — `compose(): Promise<string>`

  **Test References**:
  - `src/presentation/mcp-tools.test.ts:1-50` — Test setup pattern: `InMemoryTransport.createLinkedPair()`, `Client`, `FakeEmbedder`, temp dir setup
  - `src/presentation/mcp-tools.test.ts:18-27` — `FakeEmbedder` that needs `modelName: "fake"` property added (currently missing)

  **External References**:
  - Implementation spec Component 4 — Resource registration details for all 3 resources
  - Implementation spec Component 5 — Instructions field composition and wiring
  - Implementation spec Component 6 — Per-session priming metadata behavior
  - Implementation spec Component 7 — View tool description update with VAULT_CONTEXT
  - MCP SDK README — `server.resource()` API reference

  **WHY Each Reference Matters**:
  - `createMcpServer()` is the PRIMARY modification target — every aspect of Task 8 lives here
  - `wrapTool()` must NOT be modified — understand its wrapping to inject priming at the right point (inside view handler, before wrapTool call)
  - `McpDependencies`: The interface contract between composition root and presentation layer — extending it passes instructions + scope from Task 9 into here
  - `FakeEmbedder`: MUST add `modelName` property or new tests referencing `embedder.modelName` will fail with type errors
  - SDK resource API: Resources are registered differently from tools — study the overload that takes a static URI string

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests added to: `src/presentation/mcp-tools.test.ts` (new describe blocks)
  - [ ] `npx vitest run src/presentation/mcp-tools.test.ts` → ALL PASS (318+ existing + 11 new, 0 failures)
  - [ ] Modified file: `src/presentation/mcp-tools.ts`

  **QA Scenarios:**

  ```
  Scenario: Resources listed and readable via MCP client
    Tool: Bash (npx vitest run)
    Preconditions: Tests added to mcp-tools.test.ts covering resource registration
    Steps:
      1. Run `npx vitest run src/presentation/mcp-tools.test.ts`
      2. Verify exit code 0
      3. Verify total test count increased (318+ existing + new)
    Expected Result: All tests pass including new resource and priming tests
    Failure Indicators: Non-zero exit, FAIL output, any existing test broken
    Evidence: .sisyphus/evidence/task-8-mcp-wiring-tests.txt

  Scenario: Existing tests remain green after modifications
    Tool: Bash (npm test)
    Preconditions: All code changes applied
    Steps:
      1. Run `npm test`
      2. Verify exit code 0
      3. Verify no test regressions (count >= 318 baseline)
    Expected Result: Full test suite passes
    Failure Indicators: Any existing test fails, test count decreased
    Evidence: .sisyphus/evidence/task-8-full-suite.txt

  Scenario: Instructions field present in server initialization
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Test for instructions field exists
    Steps:
      1. Run `npx vitest run src/presentation/mcp-tools.test.ts --reporter=verbose`
      2. Find test containing "instructions" in name
      3. Verify it shows ✓ (passed)
    Expected Result: Instructions field test passes
    Failure Indicators: Test not found or failed
    Evidence: .sisyphus/evidence/task-8-instructions-field.txt

  Scenario: View priming fires once then stops
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Priming lifecycle tests exist
    Steps:
      1. Run `npx vitest run src/presentation/mcp-tools.test.ts --reporter=verbose`
      2. Find tests containing "priming" or "first" and "second" in names
      3. Verify both show ✓ (passed)
    Expected Result: First call has orientation, second does not
    Failure Indicators: Priming on second call, or missing on first
    Evidence: .sisyphus/evidence/task-8-priming-lifecycle.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(context): wire MCP resources, instructions, and view priming`
  - Files: `src/presentation/mcp-tools.ts`, `src/presentation/mcp-tools.test.ts`
  - Pre-commit: `npx vitest run src/presentation/mcp-tools.test.ts`

- [x] 9. Composition Root Wiring (TDD)

  **What to do**:
  - RED: Write integration tests in `src/index.test.ts` (new file — the composition root currently has no tests):
    - Test: `VAULT_CONTEXT` env var is read and defaults to `"general markdown notes vault"` when unset
    - Test: `VAULT_CONTEXT=""` (empty string) behaves same as unset (uses default)
    - Test: Auto-init runs BEFORE server factory is created — `meta/contract.md` and `meta/overview.md` exist after startup
    - Test: Auto-init on non-empty vault (has .md files, no meta/) → creates meta files, result has warning
    - Test: Auto-init when both meta files exist → no overwrite, no errors
    - Test: Auto-init failure (read-only vault) → logged warning, server still starts
    - Test: `instructions` string is passed through to `McpDependencies` for server factory
    - Test: `vaultScope` string is passed through to `McpDependencies` for server factory
  - GREEN: Modify `main()` in `src/index.ts`:
    1. Read `VAULT_CONTEXT` env var (treat `""` as unset, fallback to `"general markdown notes vault"`)
    2. After `fsAdapter` creation and `VAULT_PATH` validation, run `VaultAutoInitService.initialize()` — log results at appropriate levels (info for created, warn for non-empty vault warning)
    3. Create `VaultScopeResolver` with `fsAdapter` and `vaultContext`, call `resolve()` to get `resolvedScope`
    4. Call `composeInstructions(resolvedScope)` to get `instructions` string
    5. Pass `instructions` and `vaultScope: resolvedScope` into `serverFactory` closure, adding them to `McpDependencies` when creating server
  - REFACTOR: Keep init sequence clear and well-commented

  **Must NOT do**:
  - Must NOT move auto-init inside `serverFactory` — it runs ONCE in composition root, not per-connection
  - Must NOT catch auto-init errors silently — log them at appropriate level
  - Must NOT add new env vars beyond `VAULT_CONTEXT`
  - Must NOT change the order of existing initialization steps (semantic indexer, transport selection)
  - Must NOT break existing env var handling (`VAULT_PATH`, `MCP_TRANSPORT_TYPE`, etc.)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Modifies the composition root which wires all dependencies. Ordering matters (auto-init before server factory). Error handling is critical (must not crash server on init failures). Integration testing requires end-to-end verification.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 8)
  - **Blocks**: Task 10 (README documents the wired behavior)
  - **Blocked By**: Tasks 3, 4, 6 (needs scope resolver, instructions composer, auto-init service)

  **References**:

  **Pattern References**:
  - `src/index.ts:69-194` — The ENTIRE `main()` function. Study the initialization sequence: env vars → validation → adapter creation → embedder selection → indexer → server factory → transport. New code slots in between adapter creation and server factory.
  - `src/index.ts:119-139` — Embedder selection logic. Similar conditional pattern for VAULT_CONTEXT reading.

  **API/Type References**:
  - `src/use-cases/vault-auto-init.ts:VaultAutoInitService` (Task 6) — `new VaultAutoInitService({ fsAdapter, vaultContext })`, `.initialize(): Promise<AutoInitResult>`
  - `src/use-cases/vault-scope.ts:VaultScopeResolver` (Task 3) — `new VaultScopeResolver({ fsAdapter, vaultContext })`, `.resolve(): Promise<string>`
  - `src/use-cases/instructions-composer.ts:composeInstructions` (Task 4) — `composeInstructions(vaultScope: string): string`
  - `src/presentation/mcp-tools.ts:McpDependencies` (Task 8 extends this) — Interface now includes `instructions?: string`, `vaultScope?: string`

  **Test References**:
  - `src/presentation/mcp-tools.test.ts:1-50` — Integration test setup using InMemoryTransport — adapt for composition root testing
  - `src/infrastructure/local-file-system-adapter.test.ts` — Temp dir creation pattern for filesystem tests

  **External References**:
  - Implementation spec "Init flow (step-by-step)" — The exact ordering of steps 1-10

  **WHY Each Reference Matters**:
  - `main()` function: The ONLY place auto-init and scope resolution can run — must understand current flow to insert correctly
  - Embedder selection logic: Shows pattern for env var reading with fallback — follow same style for VAULT_CONTEXT
  - Spec init flow: The authoritative sequence. Steps 1-6 are what this task implements. Steps 7-10 are what Task 8 implements.

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `src/index.test.ts`
  - [ ] `npx vitest run src/index.test.ts` → PASS (8+ tests, 0 failures)
  - [ ] Modified file: `src/index.ts`

  **QA Scenarios:**

  ```
  Scenario: Full startup with auto-init on empty vault
    Tool: Bash (npx vitest run)
    Preconditions: Test file exists with temp dir scenarios
    Steps:
      1. Run `npx vitest run src/index.test.ts`
      2. Verify exit code 0
      3. Verify 8+ tests pass
    Expected Result: All composition root tests pass
    Failure Indicators: Non-zero exit, FAIL output
    Evidence: .sisyphus/evidence/task-9-composition-root-tests.txt

  Scenario: VAULT_CONTEXT env var handling
    Tool: Bash (npx vitest run --reporter=verbose)
    Preconditions: Tests cover env var scenarios
    Steps:
      1. Run `npx vitest run src/index.test.ts --reporter=verbose`
      2. Find tests containing "VAULT_CONTEXT" in name
      3. Verify tests for: unset → default, empty string → default, custom value → used
    Expected Result: All env var scenarios pass
    Failure Indicators: Wrong default applied, empty string not treated as unset
    Evidence: .sisyphus/evidence/task-9-vault-context-env.txt

  Scenario: Existing test suite unbroken
    Tool: Bash (npm test)
    Preconditions: All code changes applied
    Steps:
      1. Run `npm test`
      2. Verify exit code 0
      3. Verify no regressions in existing tests
    Expected Result: Full suite passes (318+ existing + all new)
    Failure Indicators: Any existing test fails
    Evidence: .sisyphus/evidence/task-9-full-suite.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(context): wire auto-init, scope resolution, and instructions in composition root`
  - Files: `src/index.ts`, `src/index.test.ts`
  - Pre-commit: `npx vitest run src/index.test.ts`

- [x] 10. README Documentation Update

  **What to do**:
  - Add `VAULT_CONTEXT` row to the Environment Variables table:
    - Variable: `VAULT_CONTEXT`
    - Default: `general markdown notes vault`
    - Description: One-line description of vault scope; surfaced to connected agents via MCP instructions and tool descriptions
  - Add new section `## Self-Orienting Context Layer` (after Architecture, before Conventions) covering:
    - **What it does**: Brief explanation of how connected agents auto-discover vault purpose and conventions
    - **`VAULT_CONTEXT` env var**: Purpose, examples of good values, where it appears
    - **`meta/contract.md`**: Purpose, auto-creation behavior, lifecycle (created once, never overwritten, fully editable), which sections to customize
    - **`meta/overview.md`**: Purpose, lifecycle (created once as stub, fully user-controlled)
    - **MCP Resources**: `vault://overview`, `vault://contract`, `vault://stats` — what each returns
    - **Server instructions**: What they contain, when they're computed (startup only, not hot-reloaded)
    - **First-call priming**: Brief note that first `view` call includes orientation metadata
  - Add migration note for existing users:
    - On first run after upgrade, `meta/` files auto-created if missing — non-destructive
    - Users with existing `meta/contract.md` from other tooling should review compatibility
    - No breaking changes to tool APIs

  **Must NOT do**:
  - Must NOT restructure existing README sections — only add new content
  - Must NOT add implementation details (no code samples, no internal architecture)
  - Must NOT duplicate information from CLAUDE.md
  - Must NOT exceed ~200 lines of new content — keep concise

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Pure documentation task — requires clear technical writing, consistent formatting with existing README style
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None applicable

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential — after all implementation)
  - **Blocks**: None
  - **Blocked By**: Tasks 8, 9 (must document finalized behavior, not planned behavior)

  **References**:

  **Pattern References**:
  - `README.md:1-50` — Existing README structure and tone. Match heading levels, table format, and writing style
  - `README.md` Environment Variables table — Format for adding `VAULT_CONTEXT` row

  **API/Type References**:
  - None — documentation only

  **External References**:
  - Implementation spec sections: "Component 1", "Component 2", "Component 3", "Component 4", "Component 5" — Source material for what to document
  - Implementation spec "Migration notes for existing users" — Source for migration section

  **WHY Each Reference Matters**:
  - Existing README: Must match its tone, structure, and depth level — not too verbose, not too sparse
  - Spec components: The authoritative source for accurate documentation — don't invent behavior, document what was implemented

  **Acceptance Criteria**:

  - [ ] `VAULT_CONTEXT` appears in Environment Variables table with correct default and description
  - [ ] New section `## Self-Orienting Context Layer` exists with all required subsections
  - [ ] Migration notes section explains auto-creation of `meta/` files
  - [ ] No existing README content is modified or removed
  - [ ] Documentation matches implemented behavior (verified against Tasks 8-9 output)

  **QA Scenarios:**

  ```
  Scenario: README has all required new content
    Tool: Bash (grep)
    Preconditions: README.md has been updated
    Steps:
      1. Run `grep -c "VAULT_CONTEXT" README.md` — expect >= 2 (table + section)
      2. Run `grep -c "meta/contract.md" README.md` — expect >= 1
      3. Run `grep -c "meta/overview.md" README.md` — expect >= 1
      4. Run `grep -c "vault://overview" README.md` — expect >= 1
      5. Run `grep -c "Self-Orienting" README.md` — expect >= 1
    Expected Result: All grep counts meet minimums
    Failure Indicators: Any count is 0
    Evidence: .sisyphus/evidence/task-10-readme-content-check.txt

  Scenario: README renders valid markdown
    Tool: Bash (npx markdownlint-cli2)
    Preconditions: markdownlint available (or use npx)
    Steps:
      1. Run `npx markdownlint-cli2 README.md` (or alternative linter)
      2. Check for critical errors (broken links, malformed tables)
    Expected Result: No critical markdown issues
    Failure Indicators: Broken table formatting, unclosed code blocks
    Evidence: .sisyphus/evidence/task-10-readme-lint.txt
  ```

  **Commit**: YES (Wave 4)
  - Message: `docs: document self-orienting context layer in README`
  - Files: `README.md`
  - Pre-commit: none (documentation only)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run lint` + `npm test`. Review all changed/new files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify strict TypeScript compliance (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state (empty temp dir as VAULT_PATH). Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: auto-init → resources → instructions → priming all working together. Test edge cases: read-only vault, empty VAULT_CONTEXT, malformed contract.md. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual implementation. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Verify exactly 1 new env var, 3 new resources, 2 auto-init files, 1 tool description change, 0 new tools.
  Output: `Tasks [N/N compliant] | Scope [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Key Files |
|-----------|---------|-----------|
| Wave 1 complete | `feat(context): add foundation use-cases for vault context layer` | `src/use-cases/contract-template.ts`, `overview-template.ts`, `vault-scope.ts`, `instructions-composer.ts`, `vault-stats.ts` + tests |
| Wave 2 complete | `feat(context): add auto-init service and resource overview composer` | `src/use-cases/vault-auto-init.ts`, `vault-resource-overview.ts` + tests |
| Wave 3 complete | `feat(context): wire MCP resources, instructions, and priming` | `src/presentation/mcp-tools.ts`, `src/presentation/mcp-tools.test.ts`, `src/index.ts`, `src/index.test.ts` |
| Wave 4 complete | `docs: document self-orienting context layer in README` | `README.md` |

Pre-commit for all: `npm run lint && npm test`

---

## Success Criteria

### Verification Commands
```bash
npm run lint          # Expected: exit 0 (no type errors)
npm test              # Expected: all tests pass (318+ existing + new)
npx vitest run src/use-cases/contract-template.test.ts    # New test passes
npx vitest run src/use-cases/overview-template.test.ts    # New test passes
npx vitest run src/use-cases/vault-scope.test.ts          # New test passes
npx vitest run src/use-cases/instructions-composer.test.ts # New test passes
npx vitest run src/use-cases/vault-stats.test.ts          # New test passes
npx vitest run src/use-cases/vault-auto-init.test.ts      # New test passes
npx vitest run src/use-cases/vault-resource-overview.test.ts # New test passes
npx vitest run src/presentation/mcp-tools.test.ts         # Integration tests pass (existing + new resources/priming)
npx vitest run src/index.test.ts                          # Composition root tests pass
```

### Final Checklist
- [ ] All "Must Have" present (6 components implemented)
- [ ] All "Must NOT Have" absent (no forbidden patterns)
- [ ] All tests pass (npm test)
- [ ] Type-check passes (npm run lint)
- [ ] README documents VAULT_CONTEXT, meta/ files, and their lifecycle
