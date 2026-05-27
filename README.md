<div align="center">

# 📁 Markdown Vault MCP Server

**Headless semantic [MCP](https://modelcontextprotocol.io/) server for Obsidian, Logseq, Dendron, Foam, and any folder of markdown files.**

`npm install` and point it at a folder. Hybrid search, AST editing, zero-config embeddings. No app, no plugins, no API keys.

[![CI / Release](https://github.com/wirux/mcp-markdown-vault/actions/workflows/release.yml/badge.svg)](https://github.com/wirux/mcp-markdown-vault/actions/workflows/release.yml)
[![PR Check](https://github.com/wirux/mcp-markdown-vault/actions/workflows/pr-check.yml/badge.svg)](https://github.com/wirux/mcp-markdown-vault/actions/workflows/pr-check.yml)
[![npm version](https://img.shields.io/npm/v/@wirux/mcp-markdown-vault?color=cb3837&logo=npm)](https://www.npmjs.com/package/@wirux/mcp-markdown-vault)
[![Docker](https://img.shields.io/badge/ghcr.io-mcp--markdown--vault-blue?logo=docker)](https://github.com/wirux/mcp-markdown-vault/pkgs/container/mcp-markdown-vault)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-568%20passed-brightgreen?logo=vitest&logoColor=white)](#-testing)
[![mcp-markdown-vault MCP server](https://glama.ai/mcp/servers/wirux/mcp-markdown-vault/badges/score.svg)](https://glama.ai/mcp/servers/wirux/mcp-markdown-vault)

</div>

<div align="center">

![Markdown Vault MCP Server Demo](assets/demo.gif)

</div>

---

## 💡 Why this server?

> **TL;DR** — One `npx` command. No running app. No plugins. No vector DB. Semantic search works out of the box.

| | Differentiator | Details |
|---|---|---|
| 🚫 | **No app or plugins required** | Most Obsidian MCP servers ([mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian), [obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server)) need Obsidian running with the Local REST API plugin. This server reads and writes `.md` files directly — point it at a folder and go. |
| 🧠 | **Built-in semantic search, zero setup** | Hybrid search: cosine-similarity vectors + TF-IDF + word proximity. Local embeddings (`@huggingface/transformers`, `all-MiniLM-L6-v2`, 384d) download on first run. No API keys, no external services. Ollama optional for higher quality. |
| 🔬 | **Surgical AST-based editing** | `remark` AST pipeline patches specific headings or block IDs without touching the rest of the file. Freeform line-range & string replace as fallback. Levenshtein fuzzy matching handles LLM typos. |
| 🔓 | **Tool-agnostic** | Obsidian vaults, Logseq graphs, Dendron workspaces, Foam, or any plain folder of `.md` files. If it's markdown, it works. |
| 📦 | **Single package, no infrastructure** | Unlike Python alternatives that need ChromaDB or other vector stores, everything runs in one Node.js process. `npx @wirux/mcp-markdown-vault` and you're running. Docker image available. |

<div align="center">

💎 **Obsidian** · 📓 **Logseq** · 🌳 **Dendron** · 🫧 **Foam** · 📂 **Any `.md` folder**

</div>

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🗂️ | **Headless vault ops** | Read, create, update, edit, delete `.md` notes with strict path traversal protection |
| 📑 | **Read by heading** | Read a single section by heading title — returns only content under that heading (up to the next same-level heading), saving context window space |
| 📦 | **Bulk read** | Read multiple files and/or heading-scoped sections in a single call — reduces MCP round-trips with per-item fault tolerance |
| 🔬 | **Surgical editing** | AST-based patching targets specific headings or block IDs — never overwrites the whole file |
| 🔍 | **Fragment retrieval** | Heading-aware chunking + TF-IDF + proximity scoring returns only relevant sections |
| 📂 | **Scoped search** | Optional directory filter for `global_search` and `semantic_search` — restrict results to specific folders to reduce noise |
| 🧠 | **Semantic search** | Hybrid vector + lexical search with background auto-indexing |
| ⚡ | **Zero-setup embeddings** | Built-in local embeddings via `@huggingface/transformers` — Ollama optional |
| 🔄 | **Workflow tracking** | Petri net state machine with contextual LLM hints |
| 🌐 | **Dual transport** | Stdio (single client) or SSE over HTTP (multi-client, Docker-friendly) |
| ✏️ | **Freeform editing** | Line-range replacement and string find/replace as AST fallback |
| 🏷️ | **Frontmatter management** | AST-based read and update of YAML frontmatter — safely manage tags, statuses, and metadata without corrupting file structure |
| 👀 | **Dry-run / diff preview** | Preview any edit operation as a unified diff without saving — set `dryRun=true` on any edit action |
| 📝 | **Templating / scaffolding** | Create new notes from template files with `{{variable}}` placeholder injection — refuses to overwrite existing files |
| 🗺️ | **Self-orienting vault context** | Assisted or manual `meta/overview.md` with host-visible `vault_scope` and live `vault://overview` context for connected agents |
| 📦 | **Batch edit** | Apply multiple edit operations in a single call — sequential execution, stops on first error, supports `dryRun`, max 50 ops |
| 🔗 | **Backlinks index** | Find all notes linking to a given path — supports wikilinks and markdown links with line numbers and context snippets |
| 🎯 | **Typo resilience** | Levenshtein-based fuzzy matching for edit operations |

---

## 🛠️ MCP Tools

| Tool | Actions | Description |
|---|---|---|
| 📁 **vault** | `list` `read` `create` `update` `delete` `stat` `create_from_template` | Full CRUD for vault notes + template scaffolding |
| ✏️ **edit** | `append` `prepend` `replace` `line_replace` `string_replace` `frontmatter_set` + `operations[]` batch mode | AST-based patching + freeform fallback + frontmatter update + batch edit (supports `dryRun` diff preview) |
| 👁️ **view** | `search` `global_search` `semantic_search` `outline` `read` `frontmatter_get` `bulk_read` `backlinks` | Fragment retrieval, cross-vault search, hybrid semantic search, read by heading, frontmatter read, bulk read, backlinks |
| 🔄 **workflow** | `status` `transition` `history` `reset` | Petri net state machine control |
| ⚙️ **system** | `status` `reindex` `overview` `overview_status` `prepare_overview` `save_overview` | Server health, indexing info, vault structure overview, assisted overview rebuild |

> All tool responses include contextual hints based on the current workflow state.

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- *(Optional)* [Ollama](https://ollama.com/) for higher-quality embeddings

### 📦 Install from NPM

```bash
npm install -g @wirux/mcp-markdown-vault
```

Then run directly:

```bash
VAULT_PATH=/path/to/your/vault markdown-vault-mcp
```

### 🔌 MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "markdown-vault": {
      "command": "npx",
      "args": ["-y", "@wirux/mcp-markdown-vault"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

> `npx -y` auto-installs the package if not already present — no global install needed.

> **Try it in the browser:** You can test this server directly at [Glama Inspector](https://glama.ai/mcp/servers/@wirux/mcp-markdown-vault) — no local install required.

### 🐳 Docker

Pull the pre-built multi-arch image from GitHub Container Registry:

```bash
docker pull ghcr.io/wirux/mcp-markdown-vault:latest
```

Or use Docker Compose:

```bash
docker compose up
```

Edit `docker-compose.yml` to point at your markdown vault directory. The default compose file uses SSE transport on port 3000.

### 🛠️ Development (from source)

```bash
git clone https://github.com/wirux/mcp-markdown-vault.git
cd mcp-markdown-vault
npm install
npm run build
VAULT_PATH=/path/to/your/vault node dist/index.js
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
MCP_TRANSPORT_TYPE=sse PORT=3000 VAULT_PATH=/path/to/vault npx @wirux/mcp-markdown-vault
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
| `VAULT_PATH` | `/vault` | Markdown vault directory |
| `VAULT_CONTEXT_MODE` | `assisted` | Vault orientation mode: `assisted` (host LLM/agent calls `prepare_overview` to gather evidence, then generates prose and calls `save_overview`) or `manual` (you author `meta/overview.md` yourself and the server does not overwrite it). `auto` is a deprecated alias for `assisted`. |
| `VAULT_CONTEXT` | *(deprecated)* | Deprecated and ignored. Use `VAULT_CONTEXT_MODE` instead. |
| `MCP_TRANSPORT_TYPE` | `stdio` | `stdio` (single client) or `sse` (multi-client HTTP) |
| `PORT` | `3000` | HTTP port (SSE mode only) |
| `OLLAMA_URL` | *(unset)* | Set to enable Ollama embeddings |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model name |
| `OLLAMA_DIMENSIONS` | `768` | Ollama embedding vector dimensions |
| `VECTOR_STORE_URL` | *(unset)* | Set to use Qdrant (e.g. `http://localhost:6333`). If unset, local persisted flat store is used. |
| `VECTOR_STORE_COLLECTION` | `markdown_vault` | Qdrant collection name when `VECTOR_STORE_URL` is set. |
| `VECTOR_STORE_RESET` | `false` | Set to `true` to auto-delete a mismatched vector index on startup and rebuild from scratch. |
| `MCP_AUTH_TOKEN` | *(unset)* | Bearer token for SSE transport auth. If set, all SSE endpoints require `Authorization: Bearer <token>`. |
| `HOST_BIND_ADDRESS` | `127.0.0.1` | Bind address for the SSE HTTP server. |
| `BODY_LIMIT_BYTES` | `1mb` | Max JSON request body size for SSE `POST /messages`. |

> **Note**: When using the default local vector store, a `.markdown_vault_mcp` directory will be created in your vault. It's recommended to add this directory to your `.gitignore`.

Use `assisted` mode when you want the connected host LLM/agent to generate and refresh vault context from server-provided evidence. Use `manual` mode when you want to write and maintain `meta/overview.md` yourself; in manual mode, the server creates the file if missing but does not overwrite it.

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

## Self-Orienting Context Layer

When an MCP client connects, the server provides vault context so connected agents can decide **when** to query this vault and **how** to use its tools — without explicit user instructions.

### Making agents find your vault

In `assisted` mode (the default), the server provides structural evidence through the `system` tool. The host LLM or agent follows a 3-step flow:
1. **Request Evidence**: Calls `system.prepare_overview` to gather structural data (file counts, top directories, common tags, recent titles).
2. **Generate Prose**: The host LLM — not the server — uses this evidence to write a concise 3–8 sentence semantic description of the vault.
3. **Save Overview**: Calls `system.save_overview` with the generated overview text AND a dedicated scope string to store schema v3 context in `meta/overview.md`.

Clients that support MCP prompt discovery can trigger this flow via the **`rebuild-overview`** prompt (registered as a first-class MCP prompt). In clients with prompt menus, choose **Rebuild Vault Overview**. In chat-driven clients, ask the agent to “use the `rebuild-overview` prompt”. The prompt instructs the host LLM to execute the full assisted cycle — the server still does not generate prose itself.

The legacy `auto` mode is deprecated and maps to `assisted`. It emits a warning on startup. No immediate migration action is required, but update configuration to `VAULT_CONTEXT_MODE=assisted` for clarity.

In `manual` mode, you author `meta/overview.md` yourself. Set `VAULT_CONTEXT_MODE=manual` and use the markdown body for narrative context. Manual mode is authoritative: the server creates the file if missing but never overwrites it.

```json
{
  "mcpServers": {
    "markdown-vault": {
      "command": "npx",
      "args": ["-y", "@wirux/mcp-markdown-vault"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

In both modes, `meta/overview.md` is the canonical source of vault description for connected agents: `vault_scope` in frontmatter (if present) supplies the short routing hint, while the markdown body and `meta/contract.md` feed the richer `vault://overview` resource.

### Quick start: rebuild your vault overview

After your vault contains representative notes, run the assisted rebuild flow once:

1. Start the server in assisted mode (default) with `VAULT_PATH` pointing at your vault.
2. In your MCP client, invoke **Rebuild Vault Overview** / `rebuild-overview`.
3. The agent will call `system.prepare_overview`, write a concise overview and a dedicated scope line from the returned evidence, then call `system.save_overview` with both.
4. Verify the result by reading `vault://overview` or checking `<VAULT_PATH>/meta/overview.md`.

If your client does not expose MCP prompts, ask the agent directly: “Call `system.prepare_overview`, then generate a concise vault overview and a short scope line (what agents will find here, max 200 chars), then call `system.save_overview` with both the `overview` and the `scope`.”

### How context is delivered

The server uses four complementary mechanisms so behavior degrades gracefully across clients with different MCP feature support:

| Mechanism | When | What the agent sees |
|---|---|---|
| **`instructions` field** | MCP handshake (session start) | The current `vault_scope` + tool dispatcher summary. Supported by Claude Desktop, Claude Code, Cursor. |
| **MCP Resources** | On-demand via `ReadResource` | `vault://overview` (composed view with live stats, overview, and conventions), `vault://stats` (live JSON) |
| **First-call priming** | First tool call per session, regardless of tool | `_meta.vault_orientation` block with the current `vault_scope` + hint to read `vault://overview` |
| **Tool descriptions** | Tool listing | Include the current `vault_scope` string for tool-selection matching |

Even if a client supports none of these (rare), the agent still discovers vault content through normal tool use.

### Two files: contract vs overview

On first startup, the server creates two files in `<VAULT_PATH>/meta/`. In `manual` mode, both are created once and **never overwritten** — they are fully yours to edit. In `assisted` mode, `meta/overview.md` is managed by the host via the `system` tool actions (`prepare_overview` and `save_overview`). `meta/contract.md` is created once and never overwritten.

#### `meta/contract.md` — Tool optimization (power users)

Tells agents **how** to use the vault's tools efficiently. Pre-filled with sensible defaults:

| Section | Purpose | Drives which tool |
|---|---|---|
| `## Frontmatter Schema` | YAML keys and types used across notes | `view.frontmatter_get`, `edit.frontmatter_set` |
| `## Tag Conventions` | Tag naming rules and hierarchies | `view.global_search` query building |
| `## Search Hints` | Which search action fits which query type | All `view` actions |
| `## Naming Conventions` | File naming patterns | `vault.create` |
| `## Note Template` | Default structure for new notes | `vault.create`, `vault.create_from_template` |

Most users don't need to edit this. Power users can customize it to match their vault's specific conventions — agents read it as part of the `vault://overview` resource.

> **Tip:** Keep `vault_scope` short and specific — it is the semantic one-line summary exposed to MCP hosts so they know what information this vault can answer. Put richer, multi-line context in the body of `meta/overview.md`.

The `vault_scope` frontmatter field is a semantic routing hint for connected agents. It should describe what information the host can find in this MCP server, not just repeat structural facts like file counts or tags. It helps agents decide when this vault is relevant before they read full notes. You can edit it manually if needed; changes are reflected in `vault://overview` on the next read, while handshake-visible scope may require reconnecting the MCP client.

#### `meta/overview.md` — Vault description (read-side)

In `assisted` mode: the host LLM generates this after gathering structural evidence from the server. The frontmatter uses schema v3 and includes a dedicated `vault_scope` routing hint (max 200 characters) written by the host to describe what agents can find in this vault. The body contains the full narrative description that connected agents use to understand the vault's contents.

In `manual` mode: created as an editable stub. You control the narrative description in the body: active projects, key topic areas, organizational philosophy.

Its frontmatter `vault_scope` is the primary source for handshake-visible one-line context, and its body is the primary source for the `vault://overview` resource that agents read on demand.

### Hot reload behavior

| What changed | Effect | Restart needed? |
|---|---|---|
| `meta/contract.md` | Reflected in `vault://overview` on next read | No |
| `meta/overview.md` body | Reflected in `vault://overview` on next read | No |
| Manual edits to `vault_scope` | Reflected in `vault://overview` on next read; restart/reconnect to guarantee new handshake-visible scope | Usually yes |
| `VAULT_CONTEXT_MODE` env var | Changes manual vs assisted behavior | Yes |

### Migration notes

On first run after upgrade, `meta/contract.md` and `meta/overview.md` are auto-created if missing. Existing files are never overwritten. Overviews now use schema v3 frontmatter when saved through the `system` tool.

Legacy `auto` mode is mapped to `assisted` with a deprecation warning. If you previously relied on server auto-generation, your host agent should now perform the 3-step assisted flow using `system.prepare_overview` and `system.save_overview`.

If you have a `meta/contract.md` from other tooling with a different schema, review compatibility — the server-generated contract is dedicated to mcp-markdown-vault navigation hints.

### Troubleshooting overview rebuilds

- **Prompt is not visible in your client**: use the manual instruction above; it exercises the same `prepare_overview` → `save_overview` flow.
- **Saved overview looks stale**: run `system.prepare_overview` again after adding notes, then save a newly generated overview.
- **`save_overview` fails**: ensure the overview text is non-empty and the server can write to `<VAULT_PATH>/meta/overview.md`.
- **First-call priming still shows old wording after an upgrade**: rebuild the project or update the package, then restart/reconnect the MCP client so it loads the new server artifact.


---

## 🚢 CI/CD & Release

Fully automated via GitHub Actions and [Semantic Release](https://semantic-release.gitbook.io/):

| Workflow | Trigger | What it does |
|---|---|---|
| **PR Check** | Pull request to `main` | Lint → Build → Test |
| **Release** | Push to `main` | Lint → Test → Semantic Release (NPM + GitHub Release) → Docker build & push to `ghcr.io` |

- Versioning follows [Conventional Commits](https://www.conventionalcommits.org/) — `feat:` = minor, `fix:` = patch, `feat!:` / `BREAKING CHANGE:` = major
- Docker images are built for `linux/amd64` and `linux/arm64` via QEMU
- NPM package published as [`@wirux/mcp-markdown-vault`](https://www.npmjs.com/package/@wirux/mcp-markdown-vault)
- Docker image available at [`ghcr.io/wirux/mcp-markdown-vault`](https://github.com/wirux/mcp-markdown-vault/pkgs/container/mcp-markdown-vault)

---

## 🧪 Testing

**568 tests** across 49 files, written test-first (TDD).

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
