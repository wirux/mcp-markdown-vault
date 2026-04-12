# Obsidian Semantic MCP Server

A standalone, Dockerized [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [Obsidian](https://obsidian.md/) vaults. Operates directly on the file system — no Obsidian app required.

## Features

- **Headless vault operations** — Read, create, edit, and delete `.md` notes on a Docker volume with strict path traversal protection
- **Surgical editing** — AST-based patching (append, prepend, replace) targeting specific headings or block IDs without overwriting the entire file
- **Fragment retrieval** — Heading-aware chunking with TF-IDF + word proximity scoring returns only the relevant sections of long notes, optimizing the LLM context window
- **Semantic search** — Hybrid search combining vector similarity with lexical TF-IDF scoring; background auto-indexing watches for file changes
- **Zero-setup embeddings** — Built-in local embeddings via `@huggingface/transformers` with automatic Ollama fallback — no external services required
- **Workflow tracking** — Petri net state machine (IDLE → EXPLORING → EDITING → REVIEWING) with contextual hints guiding the LLM's next steps
- **Dual transport** — Stdio (default, single client) or SSE over HTTP (multi-client, Docker-friendly)
- **Typo resilience** — Levenshtein-based fuzzy matching makes edit operations robust against LLM typos

## 5 MCP Tools

| Tool | Description |
|---|---|
| **vault** | List, read, create, delete, stat notes |
| **edit** | Surgical append/prepend/replace by heading, block ID, or document-level |
| **view** | Fragment retrieval with query, heading outline, full read |
| **workflow** | Workflow state transitions, status, history, reset |
| **system** | Server status, indexing info |

All tool responses include contextual hints based on the current workflow state.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- (Optional) [Ollama](https://ollama.com/) for higher-quality embeddings — if not available, built-in local embeddings are used automatically

### Local Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start the server (point at your vault)
VAULT_PATH=/path/to/your/vault node dist/index.js
```

### Docker

```bash
# Build and run
docker compose up --build
```

Edit `docker-compose.yml` to point `./my-vault` at your Obsidian vault directory.

### MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian-semantic-mcp/dist/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

## Transport Modes

| `MCP_TRANSPORT_TYPE` | Use case | How it works |
|---|---|---|
| `stdio` (default) | Single-client desktop apps (Claude Desktop) | Reads/writes stdin/stdout; 1:1 connection |
| `sse` | Multi-client setups (Claude Code + OpenCode via Docker) | HTTP server with SSE streams; one connection per client |

**Stdio** is the default and requires no extra config. **SSE** starts an HTTP server on `PORT` (default 3000) with:

- `GET /sse` — establishes an SSE stream (one per client)
- `POST /messages?sessionId=...` — receives JSON-RPC messages

```bash
# Start in SSE mode
MCP_TRANSPORT_TYPE=sse PORT=3000 VAULT_PATH=/path/to/vault node dist/index.js
```

Each SSE client gets its own workflow state. Shared resources (vault, vector index, embedder) are reused across all connections.

## Embedding Providers

The server selects an embedding provider automatically:

| `OLLAMA_URL` set? | Ollama reachable? | Provider used |
|---|---|---|
| No | — | Local (`@huggingface/transformers`, `Xenova/all-MiniLM-L6-v2`, 384d) |
| Yes | Yes | Ollama (`nomic-embed-text`, 768d) |
| Yes | No | Local (fallback with warning) |

No configuration is needed for the local provider — it downloads the model on first use and caches it.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `/vault` | Path to the Obsidian vault directory |
| `MCP_TRANSPORT_TYPE` | `stdio` | Transport: `stdio` (single client) or `sse` (multi-client HTTP) |
| `PORT` | `3000` | HTTP port for SSE transport |
| `OLLAMA_URL` | *(unset)* | Ollama REST API base URL — set to enable Ollama |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model name |
| `OLLAMA_DIMENSIONS` | `768` | Ollama embedding vector dimensionality |

## Architecture

Clean Architecture with four layers:

```
src/
  domain/           Errors, interfaces (ports), value objects
  use-cases/         Business logic (AST, chunking, search, workflow)
  infrastructure/    Adapters (file system, Ollama, vector store)
  presentation/      MCP tool bindings, transport layer (stdio/SSE)
```

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation and [CHANGELOG.md](CHANGELOG.md) for implementation history.

## Testing

249 tests across 20 files, written test-first (TDD).

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run src/use-cases/ast-patcher.test.ts

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

Tests use real temp directories for file system operations and in-memory MCP transport for integration tests. No external services required.

## Security

- All file paths validated through `SafePath` value object before any I/O
- Blocks path traversal attacks: `../`, URL-encoded (`%2e%2e`), double-encoded (`%252e`), backslash, null bytes
- Atomic file writes (temp file + rename) prevent partial writes
- Docker container runs as non-root user
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

## License

[MIT](LICENSE)
