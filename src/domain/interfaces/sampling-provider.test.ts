import { describe, it, expect } from "vitest";
import type { ISamplingProvider, SamplingRequest, SamplingResponse } from "./sampling-provider.js";

describe("ISamplingProvider types", () => {
  it("SamplingRequest type is structurally correct", () => {
    const req: SamplingRequest = {
      systemPrompt: "system",
      userMessage: "user",
      maxTokens: 300,
      timeoutMs: 30000,
    };
    expect(req.maxTokens).toBe(300);
  });

  it("SamplingResponse type allows optional fields", () => {
    const res: SamplingResponse = { text: "hello" };
    expect(res.text).toBe("hello");
    expect(res.model).toBeUndefined();
  });

  it("ISamplingProvider interface is satisfied by a mock", () => {
    const mock: ISamplingProvider = {
      isAvailable: () => false,
      createMessage: async (_req) => ({ text: "ok" }),
    };
    expect(mock.isAvailable()).toBe(false);
  });
});
