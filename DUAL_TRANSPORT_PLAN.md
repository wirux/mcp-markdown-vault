Action Plan: Implement Dual Transport (Stdio & SSE) for MCP Server
Goal: Add HTTP Server-Sent Events (SSE) transport alongside the existing Stdio transport to support multiple concurrent AI clients when running in Docker, while maintaining Clean Architecture and TDD.

Phase 1: Dependencies & Discovery
[x] Install required dependencies for the HTTP server: npm install express cors and npm install -D @types/express @types/cors.

[x] Review the @modelcontextprotocol/sdk documentation or types regarding SSEServerTransport to understand the required /sse (GET) and /messages (POST) endpoint structure.

Phase 2: Test-Driven Development (TDD)
[x] Create a test file for the transport factory (e.g., src/presentation/transport-factory.test.ts).

[x] Write tests verifying that MCP_TRANSPORT_TYPE=stdio returns a standard Stdio transport.

[x] Write tests verifying that MCP_TRANSPORT_TYPE=sse correctly initializes an Express app and an SSEServerTransport.

Phase 3: Transport Layer Implementation
[x] Create a TransportFactory or similar abstraction in the presentation layer.

[x] Implement the sse transport setup:

Initialize an Express application with CORS enabled (allow all origins for local development/Docker).

Create the SSEServerTransport instance.

Create a GET /sse endpoint that calls transport.start(res).

Create a POST /messages endpoint that forwards the request body to transport.handlePostMessage(req, res).

Start the HTTP server on process.env.PORT (defaulting to 3000).

Phase 4: Integration in index.ts
[x] Modify the main entry point (src/index.ts).

[x] Extract the transport initialization and replace it with the new TransportFactory.

[x] Ensure the 4-way configuration matrix is respected. The server must initialize the selected embedding provider (Ollama or Transformers.js) completely independently of the chosen transport (stdio or sse).

[x] Add graceful shutdown logic to close the HTTP server and connections when SIGINT is received.

Phase 5: Docker & Configuration Updates
[x] Update docker-compose.yml:

Expose port 3000:3000 (or the configured port).

Add commented-out environment variables to showcase how to switch to SSE: # MCP_TRANSPORT_TYPE=sse and # PORT=3000.

[x] Update README.md to document the new MCP_TRANSPORT_TYPE variable, explaining that stdio is best for single-client desktop apps (Claude Desktop), and sse is required for multi-client setups (Claude Code + OpenCode) running via Docker Compose.
