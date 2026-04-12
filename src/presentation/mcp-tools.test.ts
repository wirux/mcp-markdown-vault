import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMcpServer, type McpDependencies } from "./mcp-tools.js";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "../infrastructure/in-memory-vector-store.js";
import { WorkflowStateMachine } from "../use-cases/workflow-state.js";
import type { IEmbeddingProvider } from "../domain/interfaces/index.js";
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
    "# Daily Note\n\nToday I learned about MCP.\n",
  );

  const fsAdapter = await LocalFileSystemAdapter.create(tmpDir);
  const vectorStore = new InMemoryVectorStore();
  const embedder = new FakeEmbedder();
  const workflow = new WorkflowStateMachine();

  deps = { fsAdapter, vectorStore, embedder, workflow, vaultRoot: tmpDir };

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
    expect(parsed.result).toContain("patched");

    const fileContent = await fs.readFile(
      path.join(tmpDir, "hello.md"),
      "utf-8",
    );
    expect(fileContent).toContain("Additional info here.");
    expect(fileContent).toContain("## Getting Started");
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

// ── system tool ───────────────────────────────────────────────────

describe("system tool", () => {
  it("returns system status", async () => {
    const result = await client.callTool({
      name: "system",
      arguments: { action: "status" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.result.vaultRoot).toBe(tmpDir);
    expect(typeof parsed.result.indexedDocuments).toBe("number");
  });
});
