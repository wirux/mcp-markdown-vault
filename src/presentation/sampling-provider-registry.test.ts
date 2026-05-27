import { describe, it, expect } from "vitest";
import { SamplingProviderRegistry } from "./sampling-provider-registry.js";
import type { ISamplingProvider } from "../domain/interfaces/sampling-provider.js";

function makeProvider(available: boolean): ISamplingProvider {
  return {
    isAvailable: () => available,
    createMessage: async () => ({ text: "" }),
  };
}

describe("SamplingProviderRegistry", () => {
  it("returns null when empty", () => {
    const registry = new SamplingProviderRegistry();
    expect(registry.getProvider()).toBeNull();
  });

  it("returns null when all providers are unavailable", () => {
    const registry = new SamplingProviderRegistry();
    registry.register(makeProvider(false));
    registry.register(makeProvider(false));
    expect(registry.getProvider()).toBeNull();
  });

  it("returns first available provider", () => {
    const registry = new SamplingProviderRegistry();
    const unavailable = makeProvider(false);
    const available = makeProvider(true);
    registry.register(unavailable);
    registry.register(available);
    expect(registry.getProvider()).toBe(available);
  });

  it("returns null after unregistering the only available provider", () => {
    const registry = new SamplingProviderRegistry();
    const provider = makeProvider(true);
    registry.register(provider);
    registry.unregister(provider);
    expect(registry.getProvider()).toBeNull();
  });

  it("falls back to next available after unregistering first", () => {
    const registry = new SamplingProviderRegistry();
    const p1 = makeProvider(true);
    const p2 = makeProvider(true);
    registry.register(p1);
    registry.register(p2);
    registry.unregister(p1);
    expect(registry.getProvider()).toBe(p2);
  });

  it("size reflects registered count", () => {
    const registry = new SamplingProviderRegistry();
    expect(registry.size).toBe(0);
    const p = makeProvider(true);
    registry.register(p);
    expect(registry.size).toBe(1);
    registry.unregister(p);
    expect(registry.size).toBe(0);
  });

  it("unregister is a no-op for unknown provider", () => {
    const registry = new SamplingProviderRegistry();
    const p = makeProvider(true);
    expect(() => registry.unregister(p)).not.toThrow();
  });
});
