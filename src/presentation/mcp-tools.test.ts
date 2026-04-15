import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMcpServer, type McpDependencies } from "./mcp-tools.js";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "../infrastructure/vector-store/in-memory-vector-store.js";
import { WorkflowStateMachine } from "../use-cases/workflow-state.js";
import type { IEmbeddingProvider } from "../domain/interfaces/index.js";
import { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";
import { BacklinkIndexService } from "../use-cases/backlink-index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// ── Fake embedding provider ──────────────────────────────────────

class FakeEmbedder implements IEmbeddingProvider {
  readonly dimensions = 3;
  async embed(text: string): Promise<number[]> {
    const h = [...text].reduce((s, c) => ((s << 5) - s + c.charCodeAt(0)) | 0, 0);
    return [Math.sin(h), Math.cos(h), Math.sin(h * 2)];
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
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

  deps = { fsAdapter, vectorStore, embedder, workflow, vaultRoot: tmpDir, backlinkIndex };

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

// ── system tool ───────────────────────────────────────────────────

describe("system tool", () => {
  it("returns system status with backlinkIndexSize", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.vaultRoot).toBe(tmpDir);
    expect(typeof parsed.result.indexedDocuments).toBe("number");
    expect(typeof parsed.result.backlinkIndexSize).toBe("number");
    expect(parsed.result.backlinkIndexSize).toBeGreaterThan(0);
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
