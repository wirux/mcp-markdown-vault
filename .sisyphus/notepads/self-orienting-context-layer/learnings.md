# Learnings

## [2026-05-07] Session Start
- Project: mcp-markdown-vault, TypeScript ESM, vitest test framework
- SDK: @modelcontextprotocol/sdk v1.29.0 — McpServer(serverInfo, {instructions}) pattern
- Test pattern: InMemoryTransport.createLinkedPair() + Client from SDK
- Co-located tests: module.ts → module.test.ts in same directory
- All paths go through SafePath value object (no raw path strings)
- IFileSystemAdapter.listNotes() returns vault-relative paths as string[]
- NoteAlreadyExistsError thrown by writeNote when file exists and overwrite=false
- NoteNotFoundError thrown by readNote when file missing
- VaultIndexer.getHealthStatus() returns IndexingHealthStatus with indexingState: 'idle'|'indexing'|'error', indexedDocuments: number
- IEmbeddingProvider.modelName: string property
- wrapTool() at mcp-tools.ts:525-549 — DO NOT MODIFY
- FakeEmbedder in mcp-tools.test.ts missing modelName property — must add

## [2026-05-07] Task 8 completion
- View priming must be consumed before legacy view assertions run; integration tests can avoid cross-test coupling by priming with a first `view` call inside the `view tool` describe `beforeEach`.
- Resource integration tests can stay isolated by creating `meta/contract.md` and `meta/overview.md` only inside the specific resource tests, preserving existing file-count and overview assertions.
- MCP resource reads return text-or-blob unions; tests need a small text-resource narrowing helper before accessing `.text`.

## [2026-05-07] Task 9 completion
- Composition-root wiring is easiest to verify by extracting small exported helpers from `src/index.ts` (`readVaultContext`, orientation init, server factory) so tests avoid starting transports while still exercising real MCP initialization.
- SDK clients expose server instructions via `client.getInstructions()` after `connect()`, which is cleaner than inspecting capabilities for `InitializeResult.instructions` assertions.
