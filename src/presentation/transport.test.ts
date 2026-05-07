import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

  it("includes CORS headers in responses", async () => {
    const { port } = listen();

    const res = await fetch(`http://localhost:${port}/messages`, {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
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
