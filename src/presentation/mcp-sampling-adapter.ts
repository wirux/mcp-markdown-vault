import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ISamplingProvider, SamplingRequest, SamplingResponse } from "../domain/interfaces/sampling-provider.js";

export class McpSamplingAdapter implements ISamplingProvider {
  private readonly server: McpServer;

  constructor(server: McpServer) {
    this.server = server;
  }

  isAvailable(): boolean {
    try {
      const caps = this.server.server.getClientCapabilities();
      return caps?.sampling !== undefined;
    } catch {
      return false;
    }
  }

  async createMessage(request: SamplingRequest): Promise<SamplingResponse> {
    const result = await this.server.server.createMessage(
      {
        messages: [
          {
            role: "user",
            content: { type: "text", text: request.userMessage },
          },
        ],
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
      },
      { signal: AbortSignal.timeout(request.timeoutMs) },
    );

    const text =
      result.content.type === "text" ? result.content.text : "";

    const response: SamplingResponse = {
      text,
      model: result.model,
    };
    if (result.stopReason !== undefined) {
      response.stopReason = result.stopReason;
    }
    return response;
  }
}
