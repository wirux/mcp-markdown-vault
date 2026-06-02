import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createMcpServer, type McpDependencies } from "./mcp-tools.js";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "../infrastructure/vector-store/in-memory-vector-store.js";
import { WorkflowStateMachine } from "../use-cases/workflow-state.js";
import { VaultIndexer } from "../use-cases/vault-indexer.js";
import type { IEmbeddingProvider, IFileWatcher, WatchEventType } from "../domain/interfaces/index.js";
import { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";
import { BacklinkIndexService } from "../use-cases/backlink-index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type TextResource = { uri: string; text: string; mimeType?: string };

function getTextResourceContent(resource: unknown): TextResource {
  if (
    typeof resource === "object"
    && resource !== null
    && "text" in resource
    && typeof (resource as { text: unknown }).text === "string"
  ) {
    return resource as TextResource;
  }
  throw new Error("Expected text resource content");
}

// ── Fake embedding provider ──────────────────────────────────────

class FakeEmbedder implements IEmbeddingProvider {
  readonly dimensions = 3;
  readonly modelName = "fake";
  async embed(text: string): Promise<number[]> {
    const h = [...text].reduce((s, c) => ((s << 5) - s + c.charCodeAt(0)) | 0, 0);
    return [Math.sin(h), Math.cos(h), Math.sin(h * 2)];
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

class StubFileWatcher implements IFileWatcher {
  watch(): void {}
  on(_event: WatchEventType, _handler: (_path: string) => void): void {}
  async close(): Promise<void> {}
}

// ── Test setup ────────────────────────────────────────────────────

let tmpDir: string;
let deps: McpDependencies;
let client: Client;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));

  // Seed some notes
  await fs.mkdir(path.join(tmpDir, "daily"), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, "hello.md"),
    "---\ntitle: Hello\n---\n\n# Hello World\n\nWelcome to the vault.\n\n## Getting Started\n\nStart here.\n",
  );
  await fs.writeFile(
    path.join(tmpDir, "daily/2024-01-01.md"),
    "# Daily Note\n\nToday I learned about MCP. See [[hello]].\n",
  );

  const fsAdapter = await LocalFileSystemAdapter.create(tmpDir);
  const vectorStore = new InMemoryVectorStore();
  const embedder = new FakeEmbedder();
  const workflow = new WorkflowStateMachine();

  // Backlink index
  const backlinkPipeline = new MarkdownPipeline();
  const backlinkIndex = new BacklinkIndexService(backlinkPipeline);
  backlinkIndex.rebuildIndex([
    { path: "hello.md", content: "---\ntitle: Hello\n---\n\n# Hello World\n\nWelcome to the vault.\n\n## Getting Started\n\nStart here.\n" },
    { path: "daily/2024-01-01.md", content: "# Daily Note\n\nToday I learned about MCP. See [[hello]].\n" },
  ]);

  deps = {
    fsAdapter,
    vectorStore,
    embedder,
    workflow,
    vaultRoot: tmpDir,
    backlinkIndex,
    instructions: "test instructions",
    getVaultScope: () => "test vault",
  };

  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await cleanup();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Tool listing ──────────────────────────────────────────────────

describe("MCP Server — tool listing", () => {
  it("exposes exactly 5 tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(5);
  });

  it("exposes vault, edit, view, workflow, system tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "system", "vault", "view", "workflow"]);
  });

  it("all tools have descriptions", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it("all tool descriptions include vault scope text", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toContain("test vault");
    }
  });
});

describe("MCP Server — resources and priming", () => {
  it("listResources returns 2 resources with expected URIs", async () => {
    const result = await client.listResources();
    const uris = result.resources.map((resource) => resource.uri).sort();
    expect(uris).toEqual(["vault://overview", "vault://stats"]);
  });

  it("readResource overview returns markdown starting with vault heading", async () => {
    await fs.mkdir(path.join(tmpDir, "meta"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "meta/overview.md"),
      "---\ntitle: Overview\n---\n\n# Overview\n\nHelpful overview content.\n",
    );

    const result = await client.readResource({ uri: "vault://overview" });
    const content = result.contents[0];
    expect(content).toBeDefined();
    expect(getTextResourceContent(content).text.startsWith("# Vault Overview")).toBe(true);
  });

  it("readResource overview includes agent orientation guidance", async () => {
    const result = await client.readResource({ uri: "vault://overview" });
    const text = getTextResourceContent(result.contents[0]).text;

    expect(text).toContain("## Agent Orientation");
    expect(text).toContain("### Search Strategy");
    expect(text).toContain("view.semantic_search");
    expect(text).toContain("dryRun=true");
    expect(text).toContain("system.prepare_overview");
  });

  it("readResource overview includes contract.md content when present", async () => {
    await fs.mkdir(path.join(tmpDir, "meta"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "meta/contract.md"),
      "# Contract\n\nVault contract content.\n",
    );

    const result = await client.readResource({ uri: "vault://overview" });
    const content = result.contents[0];
    expect(content).toBeDefined();
    const text = getTextResourceContent(content).text;
    expect(text).toContain("Vault contract content.");
  });

  it("readResource stats returns valid JSON with expected fields", async () => {
    const result = await client.readResource({ uri: "vault://stats" });
    const content = result.contents[0];
    expect(content).toBeDefined();
    const parsed = JSON.parse(getTextResourceContent(content).text) as {
      fileCount: number;
      indexStatus: string;
      embeddingProvider: string;
    };

    expect(parsed.fileCount).toBe(2);
    expect(parsed.indexStatus).toBe("not started");
    expect(parsed.embeddingProvider).toBe("fake");
  });

  it("first tool call returns vault orientation priming metadata", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: { action: "list" },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

    expect(parsed.result).toEqual(["daily/2024-01-01.md", "hello.md"]);
    expect(parsed._meta.vault_orientation).toEqual({
      scope: "test vault",
      hint: "Read vault://overview resource for full vault context, search strategy, workflow guidance, and conventions.",
    });
  });

  it("second tool call does not return vault orientation priming metadata", async () => {
    await client.callTool({ name: "vault", arguments: { action: "list" } });

    const secondResult = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
    const parsed = JSON.parse((secondResult.content as Array<{ type: string; text: string }>)[0]!.text);

    expect(parsed._meta).toBeUndefined();
  });

  it("server initialization result includes non-empty instructions", () => {
    expect(client.getInstructions()).toBe("test instructions");
  });
});

// ── vault tool ────────────────────────────────────────────────────

describe("vault tool", () => {
  it("lists notes", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: { action: "list" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.result).toContain("hello.md");
    expect(parsed.result).toContain("daily/2024-01-01.md");
  });

  it("reads a note", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: { action: "read", path: "hello.md" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result).toContain("Hello World");
  });

  it("creates a new note", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: {
        action: "create",
        path: "new-note.md",
        content: "# New Note\n\nFresh content.\n",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result).toContain("created");

    // Verify file exists
    const fileContent = await fs.readFile(
      path.join(tmpDir, "new-note.md"),
      "utf-8",
    );
    expect(fileContent).toContain("Fresh content.");
  });

  it("returns error for invalid action", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: { action: "invalid" },
    });
    expect(result.isError).toBe(true);
  });

  it("includes hints in response", async () => {
    const result = await client.callTool({
      name: "vault",
      arguments: { action: "list" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.hints).toBeDefined();
    expect(parsed.hints.currentState).toBeDefined();
    expect(parsed.hints.nextActions.length).toBeGreaterThan(0);
  });
});

// ── view tool ─────────────────────────────────────────────────────

describe("view tool", () => {
  beforeEach(async () => {
    await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
  });

  it("retrieves fragments for a query", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "search", query: "Getting Started", path: "hello.md" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.length).toBeGreaterThan(0);
  });

  it("shows note headings outline", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "outline", path: "hello.md" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.some((h: { title: string }) => h.title === "Hello World")).toBe(true);
    expect(parsed.result.some((h: { title: string }) => h.title === "Getting Started")).toBe(true);
  });

  it("performs global_search across vault", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "global_search", query: "learned about MCP" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.length).toBeGreaterThan(0);
    expect(parsed.result[0].filePath).toBeDefined();
    expect(parsed.result[0].score).toBeDefined();
  });

  it("returns empty for global_search with no matches", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "global_search", query: "xyznonexistent" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result).toEqual([]);
  });

  it("performs semantic_search (returns results or empty based on index)", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "semantic_search", query: "hello world" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    // With an empty vector store, semantic_search returns empty
    expect(Array.isArray(parsed.result)).toBe(true);
  });

  it("returns error for global_search without query", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "global_search" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns backlinks for a target note", async () => {
    const result = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.target).toBe("hello.md");
    expect(parsed.result.count).toBe(1);
    expect(parsed.result.backlinks).toHaveLength(1);
    expect(parsed.result.backlinks[0].sourcePath).toBe("daily/2024-01-01.md");
    expect(parsed.result.backlinks[0].linkType).toBe("wikilink");
  });
});

// ── edit tool ─────────────────────────────────────────────────────

describe("edit tool", () => {
  it("appends content under a heading", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "append",
        heading: "Getting Started",
        headingDepth: 2,
        content: "Additional info here.",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.message).toContain("patched");

    const fileContent = await fs.readFile(
      path.join(tmpDir, "hello.md"),
      "utf-8",
    );
    expect(fileContent).toContain("Additional info here.");
    expect(fileContent).toContain("## Getting Started");
  });

  it("replaces lines with line_replace", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "daily/2024-01-01.md",
        operation: "line_replace",
        startLine: 3,
        endLine: 3,
        content: "Today I learned about freeform editing.",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.message).toContain("line_replace");

    const fileContent = await fs.readFile(
      path.join(tmpDir, "daily/2024-01-01.md"),
      "utf-8",
    );
    expect(fileContent).toContain("Today I learned about freeform editing.");
    expect(fileContent).not.toContain("Today I learned about MCP.");
  });

  it("replaces string with string_replace", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "string_replace",
        searchText: "Welcome to the vault.",
        content: "Welcome to the new vault.",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.message).toContain("string_replace");

    const fileContent = await fs.readFile(
      path.join(tmpDir, "hello.md"),
      "utf-8",
    );
    expect(fileContent).toContain("Welcome to the new vault.");
  });

  it("returns error for line_replace without startLine/endLine", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "line_replace",
        content: "x",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("returns error for string_replace without searchText", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "string_replace",
        content: "x",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("executes batch edit with multiple operations", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        operations: [
          { path: "hello.md", operation: "append", content: "Batch line 1." },
          { path: "daily/2024-01-01.md", operation: "append", content: "Batch line 2." },
        ],
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.totalRequested).toBe(2);
    expect(parsed.result.totalSucceeded).toBe(2);
    expect(parsed.result.totalFailed).toBe(0);

    const file1 = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");
    expect(file1).toContain("Batch line 1.");
    const file2 = await fs.readFile(path.join(tmpDir, "daily/2024-01-01.md"), "utf-8");
    expect(file2).toContain("Batch line 2.");
  });

  it("returns a diff and does not write for single frontmatter_set dryRun", async () => {
    const original = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "frontmatter_set",
        content: '{"status":"draft"}',
        dryRun: true,
      },
    });

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(parsed.result.message).toContain("dry-run");
    expect(parsed.result.diff).toContain("status: draft");

    const fileContent = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");
    expect(fileContent).toBe(original);
    expect(fileContent).not.toContain("status: draft");
  });

  it("writes frontmatter for single frontmatter_set when dryRun is false", async () => {
    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "frontmatter_set",
        content: '{"status":"published"}',
      },
    });

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(parsed.result.message).toContain("patched");

    const fileContent = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");
    expect(fileContent).toContain("status: published");
  });

  it("returns a diff and does not write for batch frontmatter_set dryRun", async () => {
    const original = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        operations: [
          { path: "hello.md", operation: "frontmatter_set", content: '{"category":"guide"}' },
        ],
        dryRun: true,
      },
    });

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(parsed.result.totalSucceeded).toBe(1);
    expect(parsed.result.results[0].diff).toContain("category: guide");

    const fileContent = await fs.readFile(path.join(tmpDir, "hello.md"), "utf-8");
    expect(fileContent).toBe(original);
    expect(fileContent).not.toContain("category: guide");
  });
});

// ── workflow tool ─────────────────────────────────────────────────

describe("workflow tool", () => {
  it("returns current workflow state", async () => {
    const result = await client.callTool({
      name: "workflow",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.currentState).toBe("idle");
  });

  it("fires a transition", async () => {
    const result = await client.callTool({
      name: "workflow",
      arguments: { action: "transition", transition: "search" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.currentState).toBe("exploring");
  });

  it("returns error for invalid transition", async () => {
    const result = await client.callTool({
      name: "workflow",
      arguments: { action: "transition", transition: "save" },
    });
    expect(result.isError).toBe(true);
  });
});

// ── backlink live updates ─────────────────────────────────────────

describe("backlink index — live updates via MCP operations", () => {
  it("vault.create updates backlink index", async () => {
    await client.callTool({
      name: "vault",
      arguments: {
        action: "create",
        path: "linker.md",
        content: "# Linker\n\nSee [[hello]].\n",
      },
    });

    const result = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

    // daily/2024-01-01.md (from beforeEach) + linker.md (newly created)
    expect(parsed.result.count).toBe(2);
    const sources = parsed.result.backlinks.map((b: { sourcePath: string }) => b.sourcePath).sort();
    expect(sources).toContain("linker.md");
  });

  it("vault.delete removes backlink entries from that source", async () => {
    // First verify that daily/2024-01-01.md is a backlink source
    const before = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
    const beforeParsed = JSON.parse((before.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(beforeParsed.result.count).toBe(1);

    // Delete the file that is a link source
    await client.callTool({
      name: "vault",
      arguments: { action: "delete", path: "daily/2024-01-01.md" },
    });

    const after = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "hello.md" },
    });
    const afterParsed = JSON.parse((after.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(afterParsed.result.count).toBe(0);
  });

  it("edit.string_replace updates backlink index", async () => {
    // Create the link target
    await client.callTool({
      name: "vault",
      arguments: {
        action: "create",
        path: "target.md",
        content: "# Target\n",
      },
    });

    // Replace text adding a link (string_replace bypasses AST, so wikilinks are preserved)
    const editResult = await client.callTool({
      name: "edit",
      arguments: {
        path: "hello.md",
        operation: "string_replace",
        searchText: "Welcome to the vault.",
        content: "Welcome to the vault. See [[target]].",
      },
    });
    expect(editResult.isError).toBeFalsy();

    const result = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "target.md" },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(parsed.result.count).toBe(1);
    expect(parsed.result.backlinks[0].sourcePath).toBe("hello.md");
  });

  it("full sequence: create → backlinks → delete → backlinks", async () => {
    // 1. Create target
    await client.callTool({
      name: "vault",
      arguments: { action: "create", path: "target.md", content: "# Target\n" },
    });

    // 2. Create a linking file
    await client.callTool({
      name: "vault",
      arguments: { action: "create", path: "linker.md", content: "See [[target]]\n" },
    });

    // 3. Check backlinks — should be 1
    const mid = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "target.md" },
    });
    const midParsed = JSON.parse((mid.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(midParsed.result.count).toBe(1);

    // 4. Delete the linking file
    await client.callTool({
      name: "vault",
      arguments: { action: "delete", path: "linker.md" },
    });

    // 5. Check backlinks — should be 0
    const end = await client.callTool({
      name: "view",
      arguments: { action: "backlinks", path: "target.md" },
    });
    const endParsed = JSON.parse((end.content as Array<{ type: string; text: string }>)[0]!.text);
    expect(endParsed.result.count).toBe(0);
  });
});

// ── rebuild-overview prompt ───────────────────────────────────────

describe("MCP Server — rebuild-overview prompt", () => {
  it("prompt is discoverable via listPrompts", async () => {
    const result = await client.listPrompts();
    const names = result.prompts.map((p) => p.name);
    expect(names).toContain("rebuild-overview");
    expect(names).not.toContain("vault-rebuild-overview");
  });

  it("prompt has a description in the listing", async () => {
    const result = await client.listPrompts();
    const prompt = result.prompts.find((p) => p.name === "rebuild-overview");
    expect(prompt?.description).toBeTruthy();
  });

  it("getPrompt returns instructions mentioning prepare_overview", async () => {
    const result = await client.getPrompt({ name: "rebuild-overview" });
    const text = result.messages[0]!.content as { type: string; text: string };
    expect(text.text).toContain("prepare_overview");
  });

  it("getPrompt returns instructions mentioning save_overview", async () => {
    const result = await client.getPrompt({ name: "rebuild-overview" });
    const text = result.messages[0]!.content as { type: string; text: string };
    expect(text.text).toContain("save_overview");
  });

  it("getPrompt returns instructions mentioning vault://overview", async () => {
    const result = await client.getPrompt({ name: "rebuild-overview" });
    const text = result.messages[0]!.content as { type: string; text: string };
    expect(text.text).toContain("vault://overview");
  });

  it("getPrompt instructions make clear the server does not generate prose", async () => {
    const result = await client.getPrompt({ name: "rebuild-overview" });
    const text = result.messages[0]!.content as { type: string; text: string };
    expect(text.text).toContain("server does NOT generate prose");
  });

  it("prompt returns a single user-role message", async () => {
    const result = await client.getPrompt({ name: "rebuild-overview" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
  });
});

// ── system tool ───────────────────────────────────────────────────

describe("system tool", () => {
  it("returns system status with backlinkIndexSize", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(typeof parsed.result.indexedDocuments).toBe("number");
    expect(typeof parsed.result.backlinkIndexSize).toBe("number");
    expect(parsed.result.backlinkIndexSize).toBeGreaterThan(0);
    expect(parsed.result.vaultRoot).toBeUndefined();
  });

  it("returns vault overview with folder structure", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "overview" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.totalFiles).toBe(2);
    expect(Array.isArray(parsed.result.folders)).toBe(true);

    // hello.md is in the root directory, so "." is the root
    const root = parsed.result.folders.find((f: { path: string }) => f.path === ".");
    expect(root).toBeDefined();
    expect(root.fileCount).toBe(1);

    // daily/ is a child of the root
    const daily = root.children.find((f: { path: string }) => f.path === "daily");
    expect(daily).toBeDefined();
    expect(daily.fileCount).toBe(1);
  });
});

describe("system tool — indexer health fields", () => {
  let indexerTmpDir: string;
  let indexerClient: Client;
  let indexerCleanup: () => Promise<void>;

  beforeEach(async () => {
    indexerTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-indexer-test-"));
    await fs.writeFile(
      path.join(indexerTmpDir, "note.md"),
      "# Note\n\nContent.\n",
    );

    const fsAdapter = await LocalFileSystemAdapter.create(indexerTmpDir);
    const vectorStore = new InMemoryVectorStore();
    const embedder = new FakeEmbedder();
    const workflow = new WorkflowStateMachine();
    const indexer = new VaultIndexer(
      indexerTmpDir,
      vectorStore,
      embedder,
      new StubFileWatcher(),
      fsAdapter,
    );

    const indexerDeps: McpDependencies = {
      fsAdapter,
      vectorStore,
      embedder,
      workflow,
      vaultRoot: indexerTmpDir,
      indexer,
    };

    const server = createMcpServer(indexerDeps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    indexerClient = new Client({ name: "test-indexer-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await indexerClient.connect(clientTransport);

    indexerCleanup = async () => {
      await indexerClient.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await indexerCleanup();
    await fs.rm(indexerTmpDir, { recursive: true, force: true });
  });

  it("includes indexing health fields in status response", async () => {
    const result = await indexerClient.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.indexingState).toBeDefined();
    expect(["idle", "indexing", "watching", "error"]).toContain(parsed.result.indexingState);
    expect(parsed.result.watcherState).toBeDefined();
    expect(["stopped", "active"]).toContain(parsed.result.watcherState);
    expect(typeof parsed.result.queueDepth).toBe("number");
    expect(typeof parsed.result.failureCount).toBe("number");
    expect(typeof parsed.result.indexedDocuments).toBe("number");
  });

  it("returns idle indexingState when watcher is not started", async () => {
    const result = await indexerClient.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.indexingState).toBe("idle");
    expect(parsed.result.watcherState).toBe("stopped");
    expect(parsed.result.failureCount).toBe(0);
    expect(parsed.result.lastFailure).toBeNull();
  });

  it("does not expose vault root absolute path", async () => {
    const result = await indexerClient.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.result.vaultRoot).toBeUndefined();
    expect(JSON.stringify(parsed.result)).not.toContain(indexerTmpDir);
  });
});

// ── system tool — overview actions (contract-first TDD) ───────────

describe("MCP Server — system tool — overview actions", () => {
  it("overview_status returns missing when no overview file exists", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "overview_status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { status: string; managed_by: string | null; updated_at: string | null };
    };

    expect(parsed.result.status).toBe("missing");
    expect(parsed.result.managed_by).toBeNull();
    expect(parsed.result.updated_at).toBeNull();
  });

  it("overview_status returns present with frontmatter metadata when overview file exists", async () => {
    // Write a schema v3 overview file first
    const overviewContent = [
      "---",
      "schema_version: 3",
      "vault_scope: 'test vault'",
      "updated_at: '2024-01-01T00:00:00.000Z'",
      "managed_by: host",
      "---",
      "",
      "# Vault Overview",
      "",
      "This is a test vault.",
    ].join("\n");
    await fs.mkdir(path.join(tmpDir, "meta"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "meta/overview.md"), overviewContent);

    const result = await client.callTool({
      name: "system",
      arguments: { action: "overview_status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { status: string; managed_by: string | null; updated_at: string | null };
    };

    expect(parsed.result.status).toBe("present");
    expect(parsed.result.managed_by).toBe("host");
    expect(parsed.result.updated_at).toBe("2024-01-01T00:00:00.000Z");
  });

  it("prepare_overview returns structural vault data without writing any files", async () => {
    const filesBefore = await fs.readdir(tmpDir, { recursive: true });

    const result = await client.callTool({
      name: "system",
      arguments: { action: "prepare_overview" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: {
        fileCount: number;
        directories: string[];
        tags: string[];
        recentTitles: string[];
      };
    };

    // Verify structural data is returned
    expect(typeof parsed.result.fileCount).toBe("number");
    expect(parsed.result.fileCount).toBeGreaterThan(0);
    expect(Array.isArray(parsed.result.directories)).toBe(true);
    expect(Array.isArray(parsed.result.tags)).toBe(true);
    expect(Array.isArray(parsed.result.recentTitles)).toBe(true);

    // Verify no new files were written
    const filesAfter = await fs.readdir(tmpDir, { recursive: true });
    expect(filesAfter.length).toBe(filesBefore.length);
  });

  it("prepare_overview includes known directories from seeded vault", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "prepare_overview" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { fileCount: number; directories: string[]; tags: string[]; recentTitles: string[] };
    };

    // The seeded vault has hello.md and daily/2024-01-01.md
    expect(parsed.result.fileCount).toBe(2);
    expect(parsed.result.directories).toContain("daily");
  });

  it("save_overview writes overview to meta/overview.md with schema_version:3 frontmatter", async () => {
    const overviewText = "This vault contains notes about MCP and markdown tooling.";
    const scopeText = "MCP server architecture and markdown tooling notes.";

    const result = await client.callTool({
      name: "system",
      arguments: { action: "save_overview", overview: overviewText, scope: scopeText },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { saved: boolean; path: string };
    };

    expect(parsed.result.saved).toBe(true);
    expect(parsed.result.path).toBe("meta/overview.md");

    // Verify the file was actually written
    const written = await fs.readFile(path.join(tmpDir, "meta/overview.md"), "utf-8");
    expect(written).toContain("schema_version: 3");
    expect(written).toContain("vault_scope: MCP server architecture and markdown tooling notes.");
    expect(written).not.toContain("overview:");
    expect(written).toContain(overviewText);
  });

  it("save_overview: after save, overview_status returns present", async () => {
    const overviewText = "A vault for testing the save_overview action.";
    const scopeText = "Testing scope.";

    await client.callTool({
      name: "system",
      arguments: { action: "save_overview", overview: overviewText, scope: scopeText },
    });

    const statusResult = await client.callTool({
      name: "system",
      arguments: { action: "overview_status" },
    });
    const content = statusResult.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { status: string; managed_by: string | null; updated_at: string | null };
    };

    expect(parsed.result.status).toBe("present");
    expect(parsed.result.managed_by).toBe("host");
    expect(parsed.result.updated_at).not.toBeNull();
  });
});

describe("MCP Server — tool schema and description pins", () => {
  it("edit tool description mentions dryRun", async () => {
    const result = await client.listTools();
    const editTool = result.tools.find((t) => t.name === "edit");
    expect(editTool?.description).toContain("dryRun");
  });

  it("edit tool description mentions batch operations", async () => {
    const result = await client.listTools();
    const editTool = result.tools.find((t) => t.name === "edit");
    expect(editTool?.description).toContain("batch");
  });

  it("edit tool inputSchema includes dryRun field", async () => {
    const result = await client.listTools();
    const editTool = result.tools.find((t) => t.name === "edit");
    const schema = editTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("dryRun");
  });

  it("edit tool inputSchema includes operations field for batch", async () => {
    const result = await client.listTools();
    const editTool = result.tools.find((t) => t.name === "edit");
    const schema = editTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("operations");
  });

  it("view tool description mentions outline action", async () => {
    const result = await client.listTools();
    const viewTool = result.tools.find((t) => t.name === "view");
    expect(viewTool?.description).toContain("outline");
  });

  it("view tool description mentions bulk_read", async () => {
    const result = await client.listTools();
    const viewTool = result.tools.find((t) => t.name === "view");
    expect(viewTool?.description).toContain("bulk_read");
  });

  it("view tool inputSchema includes path field", async () => {
    const result = await client.listTools();
    const viewTool = result.tools.find((t) => t.name === "view");
    const schema = viewTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("path");
  });

  it("view tool inputSchema includes directory field", async () => {
    const result = await client.listTools();
    const viewTool = result.tools.find((t) => t.name === "view");
    const schema = viewTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("directory");
  });

  it("workflow tool description mentions optional session state", async () => {
    const result = await client.listTools();
    const wfTool = result.tools.find((t) => t.name === "workflow");
    expect(wfTool?.description).toContain("optional");
  });

  it("system tool description mentions reindex", async () => {
    const result = await client.listTools();
    const sysTool = result.tools.find((t) => t.name === "system");
    expect(sysTool?.description).toContain("reindex");
  });

  it("view outline with file path returns HeadingInfo array (file mode pinned)", async () => {
    const mdPath = `${tmpDir}/pin-outline.md`;
    await fs.writeFile(mdPath, "# Title\n\n## Section\n\nContent.\n");
    const result = await client.callTool({
      name: "view",
      arguments: { action: "outline", path: "pin-outline.md" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as { result: Array<{ title: string; depth: number }> };
    expect(Array.isArray(parsed.result)).toBe(true);
    expect(parsed.result[0]).toHaveProperty("title");
    expect(parsed.result[0]).toHaveProperty("depth");
  });

  it("view outline with directory returns per-file heading arrays", async () => {
    await fs.mkdir(`${tmpDir}/dir-outline`, { recursive: true });
    await fs.writeFile(`${tmpDir}/dir-outline/alpha.md`, "# Alpha\n\n## Sub\n\nContent.\n");
    await fs.writeFile(`${tmpDir}/dir-outline/beta.md`, "# Beta\n\nContent.\n");
    const result = await client.callTool({
      name: "view",
      arguments: { action: "outline", directory: "dir-outline" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as { result: Array<{ path: string; headings: Array<{ title: string; depth: number }> }> };
    expect(Array.isArray(parsed.result)).toBe(true);
    expect(parsed.result).toHaveLength(2);
    expect(parsed.result[0]).toHaveProperty("path");
    expect(parsed.result[0]).toHaveProperty("headings");
    expect(Array.isArray(parsed.result[0]!.headings)).toBe(true);
    expect(parsed.result[0]!.headings[0]).toHaveProperty("title");
  });

  it("view outline with empty directory returns error", async () => {
    await fs.mkdir(`${tmpDir}/dir-outline-empty`, { recursive: true });
    const result = await client.callTool({
      name: "view",
      arguments: { action: "outline", directory: "dir-outline-empty" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Server — structured edit response fields", () => {
  it("single append returns changed=true, operation, and path fields", async () => {
    const mdPath = `${tmpDir}/structured-edit.md`;
    await fs.writeFile(mdPath, "# Hello\n\nOriginal content.\n");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "structured-edit.md",
        operation: "append",
        content: "Appended line.",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { message: string; changed?: boolean; operation?: string; path?: string };
    };
    expect(parsed.result.changed).toBe(true);
    expect(parsed.result.operation).toBe("append");
    expect(parsed.result.path).toBe("structured-edit.md");
  });

  it("single replace returns changed=true", async () => {
    const mdPath = `${tmpDir}/replace-test.md`;
    await fs.writeFile(mdPath, "# Title\n\n## Section\n\nOld content.\n");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "replace-test.md",
        operation: "replace",
        heading: "Section",
        headingDepth: 2,
        content: "New content.",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { changed?: boolean; operation?: string; path?: string };
    };
    expect(parsed.result.changed).toBe(true);
    expect(parsed.result.operation).toBe("replace");
    expect(parsed.result.path).toBe("replace-test.md");
  });

  it("returnContent=file returns fileContent in response", async () => {
    const mdPath = `${tmpDir}/rc-file.md`;
    await fs.writeFile(mdPath, "# File\n\nContent here.\n");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "rc-file.md",
        operation: "append",
        content: "Extra line.",
        returnContent: "file",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { fileContent?: string; changed?: boolean };
    };
    expect(typeof parsed.result.fileContent).toBe("string");
    expect(parsed.result.fileContent).toContain("Extra line.");
    expect(parsed.result.changed).toBe(true);
  });

  it("returnContent=section returns modifiedSection in response", async () => {
    const mdPath = `${tmpDir}/rc-section.md`;
    await fs.writeFile(mdPath, "# Doc\n\nDoc content.\n");

    const result = await client.callTool({
      name: "edit",
      arguments: {
        path: "rc-section.md",
        operation: "prepend",
        content: "Prepended.",
        returnContent: "section",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as {
      result: { modifiedSection?: string };
    };
    expect(typeof parsed.result.modifiedSection).toBe("string");
  });

  it("edit tool inputSchema includes returnContent field", async () => {
    const result = await client.listTools();
    const editTool = result.tools.find((t) => t.name === "edit");
    const schema = editTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("returnContent");
  });
});
