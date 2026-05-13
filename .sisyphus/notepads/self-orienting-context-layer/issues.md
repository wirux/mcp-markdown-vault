# Issues / Gotchas

## [2026-05-07] Known Issues
- McpServer constructor currently has no second arg — need to add {instructions} as ServerOptions
- FakeEmbedder in src/presentation/mcp-tools.test.ts is missing modelName property — must add "modelName: 'fake'" to FakeEmbedder class in Task 8
- VaultOverviewService.getOverview() calls stat() on every file — NEVER use this in resource callbacks
- IFileSystemAdapter paths are vault-relative (not absolute) — no leading slash needed
- writeNote creates parent directories automatically (safe to call for meta/contract.md)
- registerResource uses static URI overload: server.resource(name, uri, metadata, readCallback)

## [2026-05-07] Task 8 gotchas encountered
- Priming on the first `view` call changes `parsed.result` from arrays/strings into wrapped objects containing `_meta`; existing `view` tests fail unless they explicitly consume the first priming call beforehand.
- Enabling meta fixture files globally in test setup changes vault stats and overview totals; create them only in resource-specific tests.
- `lsp_diagnostics` on test files was noisier than `tsc --noEmit`; final verification relied on clean diagnostics for the changed source file plus passing `npm run lint` for authoritative type-checking.
