# Decisions

## [2026-05-07] Architecture Decisions
- Auto-init runs in composition root (src/index.ts) BEFORE serverFactory — once, not per-connection
- firstViewCall flag lives in createMcpServer closure scope (per-server-instance = per-session)
- Resources re-read files on each ReadResource call (no caching) to reflect user edits
- vault://stats uses VaultIndexer.getHealthStatus() for cached counts — no full re-scan
- VaultStats uses listNotes() + path parsing — never stat() on individual files
- meta/ directory excluded from file counts in stats
- VAULT_CONTEXT="" (empty string) treated same as unset → use hardcoded default
- instructions string capped at 2048 chars
- Use concrete class pattern (no new domain interfaces) for all new use-cases
- wrapTool() NOT modified — priming injected INSIDE view tool handler BEFORE wrapTool call

## [2026-05-07] Task 8 implementation decisions
- `createMcpServer()` now constructs `ServerOptions` only when `deps.instructions` is defined, satisfying exact optional typing without changing runtime behavior.
- `VaultStatsComposer` dependency object is built incrementally so optional `indexer` is only passed when present.
- View priming merges `_meta.vault_orientation` onto the raw action result with `Object.assign`, preserving the required shape while keeping `wrapTool()` untouched.
