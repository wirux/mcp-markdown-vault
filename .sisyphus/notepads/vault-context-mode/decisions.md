## [2026-05-13] Architectural Decisions

- Fan-out pattern: arrays of callbacks in VaultIndexer, NOT EventEmitter (avoid adding dep)
- No cascade: meta/* excluded at counter increment level in VaultIndexer
- Provider pattern: McpDependencies.getVaultScope: () => string (not static string)
- OverviewManager is a pure use-case — no import of VaultIndexer (wiring in composition root only)
- Auto-write of overview.md: meta/ exclusion in counter prevents re-triggering

- OverviewManager reads only YAML frontmatter plus the first H1 line, skips unreadable notes silently, and writes deterministic auto-managed output to `meta/overview.md`.
