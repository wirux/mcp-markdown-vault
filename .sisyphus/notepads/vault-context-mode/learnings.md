## [2026-05-13] Session start

Plan: vault-context-mode — 10 impl tasks + 4 final verification

## Key Architecture Facts
- VaultIndexer: setOnFileIndexed/setOnFileRemoved are single-subscriber setters. BacklinkIndex subscribes at index.ts:194-199
- vaultScope flows as static string in McpDependencies (baked at server creation)
- generateContractTemplate(_vaultContext, timestamp) — _vaultContext is UNUSED (dead param)
- VaultAutoInitService: vaultContext param only passed to contract template (dead code)
- VaultOverviewResourceComposer.compose() currently includes contract.md content (lines 59-62)
- 4 MCP surfaces: (1) serverOptions.instructions (2) view tool description line 364 (3) vault://overview resource (4) first-call priming line 484
- meta/* paths MUST be excluded from N=5 threshold counter
- vault://contract stays as separate resource, untouched

## Decisions
- VaultIndexer callbacks: addOnFileIndexed/addOnFileRemoved (multi-subscriber arrays) + addOnThresholdReached
- vaultScope staleness: surfaces 1/2/4 set at connection time (acceptable). Surface 3 always fresh (on-demand).
- Auto mode: always overwrites overview.md on refresh (user chose auto = hands-off)
- Threshold: flat N=5 (MVP)
- managed_by: 'auto' for auto mode, 'user' for manual mode
- OverviewManager scans: top dirs + file counts + tag frequency + H1 from top 10 recent files

- VaultIndexer now supports callback fan-out via addOnFileIndexed/addOnFileRemoved while preserving setOnFileIndexed/setOnFileRemoved as deprecated single-subscriber wrappers.
- Meaningful change counting lives inside VaultIndexer with default threshold 5, resets immediately after firing threshold subscribers, and ignores relative paths starting with meta/ for counting only.
- Threshold behavior is covered at exactly N=5 plus explicit resetChangeCount/getChangeCount tests to protect the auto overview refresh trigger.

- OverviewManager generation is deterministic when test time is frozen; using dynamic imports with module-specifier constants in `.test.ts` avoids false LSP diagnostics while keeping runtime `node:` built-in resolution.
