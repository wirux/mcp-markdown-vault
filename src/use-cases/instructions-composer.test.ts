import { describe, it, expect } from "vitest";
import { composeInstructions } from "./instructions-composer.js";

describe("composeInstructions", () => {
  it("starts with headless markdown vault server sentence", () => {
    const result = composeInstructions("my vault");
    expect(result).toMatch(/^Headless markdown vault MCP server\./);
  });

  it("includes vault scope in output", () => {
    const result = composeInstructions("my research vault");
    expect(result).toContain("Vault scope: my research vault");
  });

  it("lists all 5 tool dispatchers", () => {
    const result = composeInstructions("test");
    expect(result).toContain("view:");
    expect(result).toContain("vault:");
    expect(result).toContain("edit:");
    expect(result).toContain("workflow:");
    expect(result).toContain("system:");
  });

  it("includes search guidance", () => {
    const result = composeInstructions("test");
    expect(result).toContain("semantic_search");
    expect(result).toContain("global_search");
    expect(result).toContain("outline");
  });

  it("mentions vault://overview resource", () => {
    const result = composeInstructions("test");
    expect(result).toContain("vault://overview");
  });

  it("is under 2048 characters for normal scope", () => {
    const result = composeInstructions("my vault");
    expect(result.length).toBeLessThanOrEqual(2048);
  });

  it("is capped at 2048 characters for very long scope", () => {
    const longScope = "x".repeat(2000);
    const result = composeInstructions(longScope);
    expect(result.length).toBeLessThanOrEqual(2048);
  });

  it("sanitizes backticks in vault scope", () => {
    const result = composeInstructions("my `special` vault");
    expect(result).toContain("my \\`special\\` vault");
  });

  it("sanitizes brackets in vault scope", () => {
    const result = composeInstructions("vault [notes]");
    expect(result).toContain("vault \\[notes\\]");
  });

  it("uses default scope when empty string provided", () => {
    const result = composeInstructions("");
    expect(result).toContain("general markdown notes vault");
  });
});
