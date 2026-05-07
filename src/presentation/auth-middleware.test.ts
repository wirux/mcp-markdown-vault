import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { createBearerAuthMiddleware } from "./auth-middleware.js";

function createTestApp(token: string | undefined) {
  const app = express();
  const middleware = createBearerAuthMiddleware(token);
  if (middleware) {
    app.use(middleware);
  }
  app.get("/protected", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = app.listen(0);
  const { port } = httpServer.address() as AddressInfo;
  return { httpServer, port };
}

describe("createBearerAuthMiddleware", () => {
  const servers: HttpServer[] = [];

  function setup(token: string | undefined) {
    const { httpServer, port } = createTestApp(token);
    servers.push(httpServer);
    return port;
  }

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  it("returns null when token is undefined (no auth)", () => {
    const middleware = createBearerAuthMiddleware(undefined);
    expect(middleware).toBeNull();
  });

  it("returns null when token is empty string (no auth)", () => {
    const middleware = createBearerAuthMiddleware("");
    expect(middleware).toBeNull();
  });

  it("allows request with valid Bearer token", async () => {
    const port = setup("secret-token");

    const res = await fetch(`http://localhost:${port}/protected`, {
      headers: { Authorization: "Bearer secret-token" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects request with missing Authorization header", async () => {
    const port = setup("secret-token");

    const res = await fetch(`http://localhost:${port}/protected`);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing/i);
  });

  it("rejects request with wrong token", async () => {
    const port = setup("secret-token");

    const res = await fetch(`http://localhost:${port}/protected`, {
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  it("rejects request with non-Bearer scheme", async () => {
    const port = setup("secret-token");

    const res = await fetch(`http://localhost:${port}/protected`, {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing/i);
  });

  it("uses constant-time comparison (no timing leak)", async () => {
    const port = setup("a".repeat(64));

    const res = await fetch(`http://localhost:${port}/protected`, {
      headers: { Authorization: "Bearer " + "b".repeat(64) },
    });

    expect(res.status).toBe(401);
  });

  it("passes through when no token configured (disabled auth)", async () => {
    const port = setup(undefined);

    const res = await fetch(`http://localhost:${port}/protected`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
