import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import type { Server as HttpServer } from "node:http";
import { createBearerAuthMiddleware } from "./auth-middleware.js";

export type TransportType = "stdio" | "sse";

export function parseTransportType(value?: string): TransportType {
  if (value === undefined || value === "stdio") return "stdio";
  if (value === "sse") return "sse";
  throw new Error(
    `Invalid MCP_TRANSPORT_TYPE: "${value}". Must be "stdio" or "sse".`,
  );
}

export interface SseAppOptions {
  authToken?: string | undefined;
  bodyLimit?: string | undefined;
  onSessionClose?: ((server: McpServer) => void) | undefined;
}

export interface SseApp {
  app: express.Express;
  sessions: Map<string, SSEServerTransport>;
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export function createSseApp(
  serverFactory: () => McpServer,
  options?: SseAppOptions,
): SseApp {
  const app = express();
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || isLocalhostOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS: origin not allowed"));
      }
    },
  }));
  app.use(express.json({ limit: options?.bodyLimit ?? "1mb" }));

  const authMiddleware = createBearerAuthMiddleware(options?.authToken);
  if (authMiddleware) {
    app.use(authMiddleware);
  }

  const sessions = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const server = serverFactory();

    sessions.set(transport.sessionId, transport);

    res.on("close", () => {
      sessions.delete(transport.sessionId);
      options?.onSessionClose?.(server);
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId =
      typeof req.query["sessionId"] === "string"
        ? req.query["sessionId"]
        : undefined;

    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query parameter" });
      return;
    }

    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Unknown session" });
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { status?: number; statusCode?: number }).statusCode
      ?? 500;
    if (status === 413) {
      res.status(413).json({ error: "Payload too large" });
    } else if (status === 400) {
      res.status(400).json({ error: "Bad request" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return { app, sessions };
}

export interface TransportHandle {
  shutdown(): Promise<void>;
}

/**
 * Start the MCP server on the selected transport.
 *
 * - stdio: single-client, reads/writes stdin/stdout (default)
 * - sse:   multi-client HTTP, one SSE stream per client
 */
export async function startTransport(
  type: TransportType,
  serverFactory: () => McpServer,
  options?: {
    port?: number | undefined;
    authToken?: string | undefined;
    hostBindAddress?: string | undefined;
    bodyLimit?: string | undefined;
    onSessionClose?: ((server: McpServer) => void) | undefined;
  },
): Promise<TransportHandle> {
  if (type === "stdio") {
    const server = serverFactory();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return {
      shutdown: async () => {
        await server.close();
      },
    };
  }

  const { app, sessions } = createSseApp(serverFactory, {
    authToken: options?.authToken,
    bodyLimit: options?.bodyLimit,
    onSessionClose: options?.onSessionClose,
  });
  const port = options?.port ?? 3000;
  const host = options?.hostBindAddress ?? "127.0.0.1";

  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = app.listen(port, host, () => {
      console.error(`SSE transport listening on http://${host}:${port}/sse`);
      resolve(s);
    });
  });

  return {
    shutdown: async () => {
      for (const transport of sessions.values()) {
        await transport.close();
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Minimal shape of the channel that ties us to the MCP host.
 *
 * Structural on purpose: production passes `process.stdin`, tests pass a
 * `PassThrough`.
 */
export interface ParentChannel {
  on(event: "end" | "close", listener: () => void): unknown;
  resume(): unknown;
}

/**
 * Exit when the MCP host goes away.
 *
 * Under stdio the host owns our stdin. If it dies without sending SIGTERM —
 * killed, crashed, or simply exited without reaping children — no signal ever
 * reaches us, and the process would linger forever as an orphan holding the
 * embedding model resident. EOF on stdin is the only reliable indication that
 * the host is gone.
 *
 * Deliberately not registered for sse: there the process is a long-lived
 * service that must outlive individual clients.
 */
export function registerParentExitShutdown(
  type: TransportType,
  shutdown: () => void | Promise<void>,
  channel: ParentChannel = process.stdin,
): void {
  if (type !== "stdio") {
    return;
  }

  let triggered = false;
  const onParentGone = (): void => {
    if (triggered) {
      return;
    }
    triggered = true;
    void shutdown();
  };

  channel.on("end", onParentGone);
  channel.on("close", onParentGone);

  // Without an active reader the stream stays paused and 'end' never fires.
  channel.resume();
}
