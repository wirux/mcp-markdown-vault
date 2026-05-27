import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpSamplingAdapter } from "./mcp-sampling-adapter.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingRequest } from "../domain/interfaces/sampling-provider.js";

function makeRequest(overrides?: Partial<SamplingRequest>): SamplingRequest {
  return {
    systemPrompt: "You are a test assistant.",
    userMessage: "Hello",
    maxTokens: 100,
    timeoutMs: 5000,
    ...overrides,
  };
}

function makeMockServer(opts: {
  hasSamplingCap?: boolean;
  responseText?: string;
  throwOnCreate?: boolean;
}): McpServer {
  const caps = opts.hasSamplingCap ? { sampling: {} } : {};
  return {
    server: {
      getClientCapabilities: vi.fn().mockReturnValue(caps),
      createMessage: opts.throwOnCreate
        ? vi.fn().mockRejectedValue(new Error("network error"))
        : vi.fn().mockResolvedValue({
            role: "assistant",
            content: { type: "text", text: opts.responseText ?? "response" },
            model: "test-model",
            stopReason: "end_turn",
          }),
    },
  } as unknown as McpServer;
}

describe("McpSamplingAdapter", () => {
  it("isAvailable returns true when client has sampling capability", () => {
    const adapter = new McpSamplingAdapter(makeMockServer({ hasSamplingCap: true }));
    expect(adapter.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when client lacks sampling capability", () => {
    const adapter = new McpSamplingAdapter(makeMockServer({ hasSamplingCap: false }));
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when getClientCapabilities throws", () => {
    const server = {
      server: {
        getClientCapabilities: vi.fn().mockImplementation(() => { throw new Error("not connected"); }),
        createMessage: vi.fn(),
      },
    } as unknown as McpServer;
    const adapter = new McpSamplingAdapter(server);
    expect(adapter.isAvailable()).toBe(false);
  });

  it("createMessage maps SDK response to SamplingResponse", async () => {
    const adapter = new McpSamplingAdapter(
      makeMockServer({ hasSamplingCap: true, responseText: "hello world" })
    );
    const result = await adapter.createMessage(makeRequest());
    expect(result.text).toBe("hello world");
    expect(result.model).toBe("test-model");
    expect(result.stopReason).toBe("end_turn");
  });

  it("createMessage returns empty text for non-text content type", async () => {
    const server = {
      server: {
        getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
        createMessage: vi.fn().mockResolvedValue({
          role: "assistant",
          content: { type: "image", data: "base64data", mimeType: "image/png" },
          model: "test-model",
        }),
      },
    } as unknown as McpServer;
    const adapter = new McpSamplingAdapter(server);
    const result = await adapter.createMessage(makeRequest());
    expect(result.text).toBe("");
  });

  it("createMessage passes AbortSignal with timeoutMs to SDK createMessage", async () => {
    const mockCreateMessage = vi.fn().mockResolvedValue({
      role: "assistant",
      content: { type: "text", text: "ok" },
      model: "test-model",
    });
    const server = {
      server: {
        getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
        createMessage: mockCreateMessage,
      },
    } as unknown as McpServer;
    const adapter = new McpSamplingAdapter(server);
    await adapter.createMessage(makeRequest({ timeoutMs: 5000 }));
    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 100 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("createMessage propagates SDK errors", async () => {
    const adapter = new McpSamplingAdapter(
      makeMockServer({ hasSamplingCap: true, throwOnCreate: true })
    );
    await expect(adapter.createMessage(makeRequest())).rejects.toThrow("network error");
  });

  describe("timeout handling", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("times out when createMessage hangs", async () => {
      const server = {
        server: {
          getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
          createMessage: vi.fn().mockReturnValue(new Promise(() => {})),
        },
      } as unknown as McpServer;
      const adapter = new McpSamplingAdapter(server);

      let timedOut = false;
      const timeoutId = setTimeout(() => { timedOut = true; }, 1000);
      await vi.advanceTimersByTimeAsync(1001);
      clearTimeout(timeoutId);
      expect(timedOut).toBe(true);

      expect(adapter.isAvailable()).toBe(true);
    });
  });
});
