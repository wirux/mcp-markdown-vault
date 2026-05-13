# Decisions — audit-remediation

## [2026-05-07] Interview Decisions

| Decision | Choice |
|----------|--------|
| SSE trust model | Bind to loopback (127.0.0.1) default; env var HOST_BIND_ADDRESS for 0.0.0.0 |
| Symlinks | Allowed if realpath resolves inside vault root |
| Windows paths | Add support + write tests |
| Body limit | Configurable via BODY_LIMIT_BYTES env var, default 1mb |
| Validation errors | Convert plain Error in mcp-tools.ts to DomainError subclasses (keep actionable) |
| VaultIndexer | Fix bug AND refactor behind IFileSystemAdapter + IFileWatcher ports |
| Test strategy | TDD (Red-Green-Refactor) |
| Scope | P0 + P1 only — no P2 architecture refactor, no performance work |
