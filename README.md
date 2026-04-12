<div align="center">

# 🔮 Obsidian Semantic MCP Server

**A headless, Dockerized [MCP](https://modelcontextprotocol.io/) server for [Obsidian](https://obsidian.md/) vaults**

Semantic search, surgical editing, and workflow tracking — no Obsidian app required.

[![CI / Release](https://github.com/Wirux/mcp-obsidian/actions/workflows/release.yml/badge.svg)](https://github.com/Wirux/mcp-obsidian/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/obsidian-semantic-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/obsidian-semantic-mcp)
[![Docker](https://img.shields.io/badge/ghcr.io-obsidian--mcp-blue?logo=docker)](https://ghcr.io/wirux/mcp-obsidian)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-277%20passed-brightgreen?logo=vitest&logoColor=white)](#-testing)

</div>

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🗂️ | **Headless vault ops** | Read, create, edit, delete `.md` notes with strict path traversal protection |
| 🔬 | **Surgical editing** | AST-based patching targets specific headings or block IDs — never overwrites the whole file |
| 🔍 | **Fragment retrieval** | Heading-aware chunking + TF-IDF + proximity scoring returns only relevant sections |
| 🧠 | **Semantic search** | Hybrid vector + lexical search with background auto-indexing |
| ⚡ | **Zero-setup embeddings** | Built-in local embeddings via `@huggingface/transformers` — Ollama optional |
| 🔄 | **Workflow tracking** | Petri net state machine with contextual LLM hints |
| 🌐 | **Dual transport** | Stdio (single client) or SSE over HTTP (multi-client, Docker-friendly) |
| ✏️ | **Freeform editing** | Line-range replacement and string find/replace as AST fallback |
| 🎯 | **Typo resilience** | Levenshtein-based fuzzy matching for edit operations |

---

## 🛠️ MCP Tools

| Tool | Actions | Description |
|---|---|---|
| 📁 **vault** | `list` `read` `create` `delete` `stat` | Full CRUD for vault notes |
| ✏️ **edit** | `append` `prepend` `replace` `line_replace` `string_replace` | AST-based patching + freeform fallback |
| 👁️ **view** | `search` `global_search` `semantic_search` `outline` `read` | Fragment retrieval, cross-vault search, hybrid semantic search |
| 🔄 **workflow** | `status` `transition` `history` `reset` | Petri net state machine control |
| ⚙️ **system** | `status` `reindex` | Server health and indexing info |

> All tool responses include contextual hints based on the current workflow state.

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- *(Optional)* [Ollama](https://ollama.com/) for higher-quality embeddings

### 📦 Install & Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Start the server
VAULT_PATH=/path/to/your/vault node dist/index.js
```

### 🐳 Docker

```bash
docker compose up --build
```

Edit `docker-compose.yml` to point at your Obsidian vault directory.

### 🔌 MCP Client Configuration

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

---

## 🌐 Transport Modes

| Mode | Use case | How it works |
|---|---|---|
| 📡 `stdio` *(default)* | Single-client desktop apps (Claude Desktop) | Reads/writes stdin/stdout; 1:1 connection |
| 🌊 `sse` | Multi-client setups (Docker, Claude Code) | HTTP server with SSE streams; one connection per client |

**SSE** starts an HTTP server on `PORT` (default `3000`):

- `GET /sse` — establishes an SSE stream (one per client)
- `POST /messages?sessionId=...` — receives JSON-RPC messages

```bash
MCP_TRANSPORT_TYPE=sse PORT=3000 VAULT_PATH=/path/to/vault node dist/index.js
```

Each SSE client gets its own workflow state. Shared resources (vault, vector index, embedder) are reused across all connections.

---

## 🧠 Embedding Providers

The server selects an embedding provider automatically:

| `OLLAMA_URL` set? | Ollama reachable? | Provider used |
|---|---|---|
| ❌ No | — | 🏠 Local (`@huggingface/transformers`, `all-MiniLM-L6-v2`, 384d) |
| ✅ Yes | ✅ Yes | 🦙 Ollama (`nomic-embed-text`, 768d) |
| ✅ Yes | ❌ No | 🏠 Local *(fallback with warning)* |

> No configuration needed for local embeddings — the model downloads on first use and is cached automatically.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `/vault` | Obsidian vault directory |
| `MCP_TRANSPORT_TYPE` | `stdio` | `stdio` (single client) or `sse` (multi-client HTTP) |
| `PORT` | `3000` | HTTP port (SSE mode only) |
| `OLLAMA_URL` | *(unset)* | Set to enable Ollama embeddings |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model name |
| `OLLAMA_DIMENSIONS` | `768` | Ollama embedding vector dimensions |

---

## 🏗️ Architecture

Clean Architecture with strict layer separation:

```
src/
├── domain/           🔷 Errors, interfaces (ports), value objects
├── use-cases/        🔶 Business logic (AST, chunking, search, workflow)
├── infrastructure/   🟢 Adapters (file system, Ollama, vector store)
└── presentation/     🟣 MCP tool bindings, transport layer (stdio/SSE)
```

See [CLAUDE.md](CLAUDE.md) for detailed architecture docs and [CHANGELOG.md](CHANGELOG.md) for implementation history.

---

## 🧪 Testing

**277 tests** across 22 files, written test-first (TDD).

```bash
npm test                                          # Run all tests
npx vitest run src/use-cases/ast-patcher.test.ts  # Single file
npm run test:watch                                # Watch mode
npm run test:coverage                             # Coverage report
```

> Tests use real temp directories for file system operations and in-memory MCP transport for integration tests. No external services required.

---

## 🔒 Security

- 🛡️ All file paths validated through `SafePath` value object before any I/O
- 🚫 Blocks path traversal: `../`, URL-encoded (`%2e%2e`), double-encoded (`%252e`), backslash, null bytes
- ✍️ Atomic file writes (temp file + rename) prevent partial writes
- 👤 Docker container runs as non-root user

---

## 📄 License

[MIT](LICENSE)
