import { describe, it, expect } from "vitest";
import { NullSamplingProvider } from "./null-sampling-provider.js";

describe("NullSamplingProvider", () => {
  it("isAvailable() returns false", () => {
    const provider = new NullSamplingProvider();
    expect(provider.isAvailable()).toBe(false);
  });

  it("createMessage() rejects with descriptive error", async () => {
    const provider = new NullSamplingProvider();
    await expect(
      provider.createMessage({
        systemPrompt: "",
        userMessage: "",
        maxTokens: 100,
        timeoutMs: 5000,
      })
    ).rejects.toThrow("not available");
  });
});
