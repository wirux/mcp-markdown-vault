# Issues & Gotchas — audit-remediation

## [2026-05-07] Known Gotchas (pre-implementation)

### Symlink Containment
- For NEW file writes: can't realpath non-existent file → validate nearest existing PARENT ancestor's canonical path
- Vault root itself could be a symlink → resolve once at startup, store as canonicalRoot
- All file ops need containment: read, write, delete, exists, stat, list

### VaultIndexer Bug
- `processQueue()` never called after `enqueue()` — queue fills but never drains
- Must add serialization guard (isProcessing flag) to prevent concurrent runs
- After isProcessing released, check if queue has new items and re-drain

### Transport Tests
- `transport.test.ts` currently expects `*` CORS — must be UPDATED (not just added alongside) to match new localhost-only behavior

### VaultIndexer Tests
- `vault-indexer.test.ts` currently manually drains queue via `processQueue()` — must be updated to verify auto-drain

### Express Error Handling
- body-parser 413/400 errors bypass tool-level error handler — need transport-level error middleware
- Error middleware AFTER routes: 4-arg `(err, req, res, next)` signature

### SafePath Edge Case
- Literal `/` input → reject with AbsolutePathError (not a valid note path)
- `%2F` URL-encoded slash must also be rejected
- Windows: `C:\Windows` and `C:/Users` and `\\server\share` and `//server/share` all → rejected

### CORS + Non-browser Clients
- Requests WITHOUT Origin header must still work (non-browser MCP clients)
- Only reject explicitly non-localhost Origins

### Absolute Path Rejection
- May break clients using `/` as "vault root" shorthand — this is intentional per user decision
