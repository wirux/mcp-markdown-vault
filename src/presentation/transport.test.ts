import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as RealMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseTransportType, createSseApp } from "./transport.js";

function createMockServerFactory() {
  // Replicate real Protocol.connect() behavior: it calls transport.start()
  return vi.fn(
    () =>
      ({
        connect: vi.fn(async (transport: { start: () => Promise<void> }) => {
          await transport.start();
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }) as unknown as McpServer,
  );
}

describe("parseTransportType", () => {
  it("defaults to stdio when undefined", () => {
    expect(parseTransportType(undefined)).toBe("stdio");
  });

  it("returns stdio for 'stdio'", () => {
    expect(parseTransportType("stdio")).toBe("stdio");
  });

  it("returns sse for 'sse'", () => {
    expect(parseTransportType("sse")).toBe("sse");
  });

  it("throws for invalid value", () => {
    expect(() => parseTransportType("websocket")).toThrow(
      /Invalid MCP_TRANSPORT_TYPE/,
    );
  });
});

describe("createSseApp", () => {
  const openServers: HttpServer[] = [];

  afterEach(async () => {
    for (const s of openServers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    openServers.length = 0;
  });

  function listen(factory?: () => McpServer) {
    const serverFactory = factory ?? createMockServerFactory();
    const { app, sessions } = createSseApp(serverFactory);
    const httpServer = app.listen(0);
    openServers.push(httpServer);
    const { port } = httpServer.address() as AddressInfo;
    return { app, sessions, httpServer, port, serverFactory };
  }

  it("POST /messages returns 400 without sessionId", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/i);
  });

  it("POST /messages returns 404 for unknown sessionId", async () => {
    const { port } = listen();

    const res = await fetch(
      `http://localhost:${port}/messages?sessionId=nonexistent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(404);
  });

  it("GET /sse establishes SSE connection and registers session", async () => {
    const { port, sessions, serverFactory } = listen();

    const controller = new AbortController();
    try {
      const response = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
      });

      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(sessions.size).toBe(1);
      expect(serverFactory).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
    }
  });

  it("creates separate server instance per SSE connection", async () => {
    const { port, sessions, serverFactory } = listen();

    const c1 = new AbortController();
    const c2 = new AbortController();
    try {
      await fetch(`http://localhost:${port}/sse`, { signal: c1.signal });
      await fetch(`http://localhost:${port}/sse`, { signal: c2.signal });

      expect(sessions.size).toBe(2);
      expect(serverFactory).toHaveBeenCalledTimes(2);
    } finally {
      c1.abort();
      c2.abort();
    }
  });

  it("cleans up session on client disconnect", async () => {
    const { port, sessions } = listen();

    const controller = new AbortController();
    await fetch(`http://localhost:${port}/sse`, {
      signal: controller.signal,
    });
    expect(sessions.size).toBe(1);

    controller.abort();

    // Wait for the close event to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessions.size).toBe(0);
  });

  it("allows localhost origins in CORS", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/messages`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("rejects non-localhost origins in CORS", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/messages`, {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(res.status).toBe(500);
  });

  it("returns 413 JSON when body exceeds bodyLimit", async () => {
    const serverFactory = createMockServerFactory();
    const { app } = createSseApp(serverFactory, { bodyLimit: "1b" });
    const httpServer = app.listen(0);
    openServers.push(httpServer);
    const { port } = httpServer.address() as AddressInfo;

    const res = await fetch(`http://localhost:${port}/messages?sessionId=x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ large: "x".repeat(100) }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Payload too large");
  });

  it("returns 400 JSON for malformed JSON body", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/messages?sessionId=x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Bad request");
  });
});

describe("createSseApp with auth", () => {
  const openServers: HttpServer[] = [];

  afterEach(async () => {
    for (const s of openServers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    openServers.length = 0;
  });

  function listenWithAuth(token: string) {
    const serverFactory = createMockServerFactory();
    const { app, sessions } = createSseApp(serverFactory, {
      authToken: token,
    });
    const httpServer = app.listen(0);
    openServers.push(httpServer);
    const { port } = httpServer.address() as AddressInfo;
    return { sessions, port, serverFactory };
  }

  it("GET /sse rejects without token when auth is enabled", async () => {
    const { port } = listenWithAuth("test-token");

    const controller = new AbortController();
    try {
      const res = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(401);
    } finally {
      controller.abort();
    }
  });

  it("POST /messages rejects without token when auth is enabled", async () => {
    const { port } = listenWithAuth("test-token");

    const res = await fetch(
      `http://localhost:${port}/messages?sessionId=abc`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(401);
  });

  it("GET /sse allows with valid token", async () => {
    const { port, sessions } = listenWithAuth("test-token");

    const controller = new AbortController();
    try {
      const res = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
        headers: { Authorization: "Bearer test-token" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(sessions.size).toBe(1);
    } finally {
      controller.abort();
    }
  });

  it("POST /messages allows with valid token", async () => {
    const { port } = listenWithAuth("test-token");

    const res = await fetch(
      `http://localhost:${port}/messages?sessionId=nonexistent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({}),
      },
    );
    // 404 = auth passed, session not found (expected)
    expect(res.status).toBe(404);
  });
});

describe("streamable HTTP endpoint (/mcp)", () => {
  const openServers: HttpServer[] = [];

  afterEach(async () => {
    for (const s of openServers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    openServers.length = 0;
  });

  function listen(options?: { authToken?: string }) {
    const serverFactory = vi.fn(() => {
      const server = new RealMcpServer(
        { name: "test-server", version: "1.0.0" },
      );
      void server.registerTool(
        "echo",
        { description: "echo tool for transport tests" },
        async () => ({ content: [{ type: "text", text: "echo" }] }),
      );
      return server as unknown as McpServer;
    });
    const { app, sessions } = createSseApp(serverFactory, options);
    const httpServer = app.listen(0);
    openServers.push(httpServer);
    const { port } = httpServer.address() as AddressInfo;
    return { port, sessions, serverFactory };
  }

  it("completes a real client handshake and request over POST /mcp", async () => {
    const { port, serverFactory } = listen();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
    );
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("echo");

    await client.close();
    expect(serverFactory).toHaveBeenCalled();
  });

  it("does not assign streamable sessions (stateless)", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "probe", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    await res.text();
  });

  it("GET /mcp answers 405", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/mcp`);
    expect(res.status).toBe(405);
  });

  it("DELETE /mcp answers 405", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "DELETE",
    });
    expect(res.status).toBe(405);
  });

  it("rejects POST /mcp without token when auth is enabled", async () => {
    const { port } = listen({ authToken: "test-token" });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("allows POST /mcp with valid token when auth is enabled", async () => {
    const { port } = listen({ authToken: "test-token" });

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: "Bearer test-token" },
        },
      },
    );
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("echo");
    await client.close();
  });

  it("coexists with the legacy SSE transport", async () => {
    const { port, sessions } = listen();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
    );
    await client.connect(transport);
    await client.close();

    const controller = new AbortController();
    try {
      const res = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(sessions.size).toBe(1);
    } finally {
      controller.abort();
    }
  });
});
