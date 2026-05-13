# Draft: Vault Context Orientation Refactor

## Requirements (confirmed from spec)

- VAULT_CONTEXT free-text env var deprecated/removed
- New config: VAULT_CONTEXT_MODE=auto|manual
- meta/overview.md = canonical read-side vault description
- meta/contract.md = write-side guidance only (naming, frontmatter, templates, mutation hints)
- Auto-refresh is event-driven: after indexAll, after N file changes, with debounce
- No timer-based refresh
- No heavyweight startup scan

## Current Architecture (research findings)

### VAULT_CONTEXT data flow
1. `readVaultContext()` in `index.ts:28-31` reads env, default: `"general markdown notes vault"`
2. Passed to `initializeVaultOrientation()` → creates `vaultScope` and `instructions`
3. `composeInstructions(vaultScope)` embeds scope in MCP handshake instructions
4. `vaultScope` passed as `McpDependencies.vaultScope` to:
   - View tool description (line 364): `Vault scope: ${deps.vaultScope}`
   - First-call priming (line 484): `_meta.vault_orientation.scope`
   - `VaultOverviewResourceComposer` constructor (line 72): used in `# Vault: ${safeScope}` heading

### Agent-facing surfaces where scope appears
1. **MCP instructions** (handshake): `instructions-composer.ts` → `"Vault scope: ${safeScope}"`
2. **View tool description**: inline scope string
3. **First-call priming**: `_meta.vault_orientation` on first view call
4. **vault://overview resource**: composed heading `# Vault: ${safeScope}` + stats + contract.md + overview.md body

### Current meta file handling
- **overview-template.ts**: generates empty stub with `managed_by: user` frontmatter
- **contract-template.ts**: generates default write-side template (frontmatter schema, tags, search hints, naming, note template). `_vaultContext` param is unused!
- **vault-auto-init.ts**: creates both files if missing, never overwrites
- **vault-resource-overview.ts**: composes vault://overview from scope heading + stats + contract + overview body

### Key observations
- `generateContractTemplate()` already ignores `_vaultContext` (prefixed with `_`)
- Contract already contains mostly write-side content (frontmatter schema, naming, templates)
- Contract has a comment suggesting "add ## Scope here" — this is read-side scope in a write-side file
- vault://overview currently mixes: scope heading + stats + full contract + overview body
- VaultIndexer has `onFileIndexed`/`onFileRemoved` callbacks — good hooks for refresh triggers
- indexAll exists and runs on startup async

### Files that need changes
1. `src/index.ts` — config reading, VaultOrientation, initializeVaultOrientation()
2. `src/use-cases/instructions-composer.ts` — source scope from overview instead of env
3. `src/use-cases/vault-resource-overview.ts` — stop embedding contract, source from overview
4. `src/use-cases/overview-template.ts` — new schema with summary field
5. `src/use-cases/contract-template.ts` — remove scope-related comments
6. `src/use-cases/vault-auto-init.ts` — handle auto vs manual mode
7. `src/presentation/mcp-tools.ts` — McpDependencies, createMcpServer, view tool desc, priming
8. NEW: `src/use-cases/overview-manager.ts` — auto-generation, refresh logic, caching
9. Tests for all of the above

## Decisions (confirmed)

- **VAULT_CONTEXT backward compat**: Warn and ignore. Log deprecation warning, proceed with VAULT_CONTEXT_MODE logic.
- **Default mode**: auto (zero-config experience)
- **vault://overview composition**: Overview + stats only. Contract stays at vault://contract. Clean read/write separation.
- **Auto-generation strategy**: Structural heuristics + first-heading extraction. Deterministic, no LLM. Top dirs, file counts, tag frequency, frontmatter patterns, H1 headings from top files.
- **Refresh threshold N**: 5 meaningful file changes
- **Test strategy**: TDD (RED-GREEN-REFACTOR)

## Open Questions
(none remaining)

## Scope Boundaries
- INCLUDE: All code changes for VAULT_CONTEXT_MODE, overview schema, contract cleanup, refresh logic, tests, docs
- EXCLUDE: Complex learning systems, LLM-based rewriting, periodic timers, mixing read/write concerns
