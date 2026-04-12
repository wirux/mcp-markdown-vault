import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import type { Server as HttpServer } from "node:http";

export type TransportType = "stdio" | "sse";

/**
 * Validate and parse the MCP_TRANSPORT_TYPE environment variable.
 */
export function parseTransportType(value?: string): TransportType {
  if (value === undefined || value === "stdio") return "stdio";
  if (value === "sse") return "sse";
  throw new Error(
    `Invalid MCP_TRANSPORT_TYPE: "${value}". Must be "stdio" or "sse".`,
  );
}

export interface SseApp {
  app: express.Express;
  sessions: Map<string, SSEServerTransport>;
}

/**
 * Create an Express app wired for SSE transport.
 *
 * - GET  /sse       — establishes an SSE stream (one per client)
 * - POST /messages   — forwards JSON-RPC messages to the correct session
 *
 * Each GET /sse connection gets its own McpServer instance (via serverFactory)
 * so workflow state is isolated per client.
 */
export function createSseApp(serverFactory: () => McpServer): SseApp {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const sessions = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const server = serverFactory();

    // Register session before connect (which writes SSE headers)
    // so it's available by the time the client receives the response.
    sessions.set(transport.sessionId, transport);

    res.on("close", () => {
      sessions.delete(transport.sessionId);
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
  options?: { port?: number | undefined },
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

  // SSE transport
  const { app, sessions } = createSseApp(serverFactory);
  const port = options?.port ?? 3000;

  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = app.listen(port, () => {
      console.error(`SSE transport listening on http://localhost:${port}/sse`);
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
