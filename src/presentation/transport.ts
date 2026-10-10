import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

  // Streamable HTTP transport (stateless): one fresh server and transport
  // per POST request, no session IDs. Clients that only speak Streamable
  // HTTP (for example opencode V2's remote MCP client) POST here; legacy
  // SSE clients keep using /sse + /messages. Both mounts coexist.
  app.post("/mcp", async (req, res) => {
    try {
      const server = serverFactory();
      // `sessionIdGenerator: undefined` selects stateless mode (documented in
      // the SDK's JSDoc). The SDK's option and Transport types predate
      // exactOptionalPropertyTypes and reject that documented spelling,
      // hence the two casts below.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0]);

      res.on("close", () => {
        void transport.close();
        void server.close();
        options?.onSessionClose?.(server);
      });

      await server.connect(
        transport as unknown as Parameters<McpServer["connect"]>[0],
      );
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Streamable HTTP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // The server has no use for the optional server-to-client stream, so
  // GET and DELETE answer 405 as the Streamable HTTP spec allows.
  app.get("/mcp", async (_req, res) => {
    res.writeHead(405, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      }),
    );
  });

  app.delete("/mcp", async (_req, res) => {
    res.writeHead(405, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      }),
    );
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
 * - sse:   multi-client HTTP, one SSE stream per client, plus a stateless
 *          Streamable HTTP endpoint on /mcp for clients that POST only
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
      console.error(`HTTP transport listening on http://${host}:${port}/sse (SSE) and /mcp (Streamable HTTP)`);
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
