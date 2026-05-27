import { describe, it, expect } from "vitest";
import {
  buildSamplingPrompt,
  parseSamplingResponse,
  SAMPLING_MAX_TOKENS,
  SAMPLING_TIMEOUT_MS,
  MAX_CONTEXT_CHARS,
} from "./sampling-prompt.js";
import { MAX_SCOPE_CHARS } from "./vault-scope.js";
import type { VaultEvidence } from "./evidence-hash.js";
import type { SamplingResponse } from "../domain/interfaces/sampling-provider.js";

const evidence: VaultEvidence = {
  totalFiles: 5,
  directories: ["notes", "projects"],
  tags: ["alpha", "beta"],
  titles: ["Note A", "Note B"],
};

describe("buildSamplingPrompt", () => {
  it("returns a SamplingRequest with correct constants", () => {
    const req = buildSamplingPrompt(evidence);
    expect(req.maxTokens).toBe(SAMPLING_MAX_TOKENS);
    expect(req.timeoutMs).toBe(SAMPLING_TIMEOUT_MS);
    expect(typeof req.systemPrompt).toBe("string");
    expect(req.systemPrompt.length).toBeGreaterThan(0);
  });

  it("encodes evidence as JSON in userMessage", () => {
    const req = buildSamplingPrompt(evidence);
    const parsed = JSON.parse(req.userMessage) as unknown;
    expect(parsed).toMatchObject({
      totalFiles: 5,
      directories: ["notes", "projects"],
      tags: ["alpha", "beta"],
      titles: ["Note A", "Note B"],
    });
  });
});

describe("parseSamplingResponse", () => {
  function makeResponse(text: string): SamplingResponse {
    return { text };
  }

  it("returns ok=true for valid response", () => {
    const res = makeResponse(
      JSON.stringify({ vault_scope: "A scope", vault_context: "A context" })
    );
    const result = parseSamplingResponse(res);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault_scope).toBe("A scope");
      expect(result.vault_context).toBe("A context");
    }
  });

  it("returns ok=false for non-JSON text", () => {
    const result = parseSamplingResponse(makeResponse("not json"));
    expect(result.ok).toBe(false);
  });

  it("returns ok=false for JSON array", () => {
    const result = parseSamplingResponse(makeResponse("[]"));
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when vault_scope is missing", () => {
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_context: "ctx" }))
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when vault_context is missing", () => {
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_scope: "scope" }))
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when vault_scope is empty string", () => {
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_scope: "  ", vault_context: "ctx" }))
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when vault_scope is not a string", () => {
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_scope: 42, vault_context: "ctx" }))
    );
    expect(result.ok).toBe(false);
  });

  it("truncates vault_scope to MAX_SCOPE_CHARS", () => {
    const longScope = "a".repeat(MAX_SCOPE_CHARS + 50);
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_scope: longScope, vault_context: "ctx" }))
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault_scope.length).toBeLessThanOrEqual(MAX_SCOPE_CHARS);
    }
  });

  it("truncates vault_context to MAX_CONTEXT_CHARS", () => {
    const longCtx = "b".repeat(MAX_CONTEXT_CHARS + 100);
    const result = parseSamplingResponse(
      makeResponse(JSON.stringify({ vault_scope: "scope", vault_context: longCtx }))
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault_context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    }
  });

  it("never throws on any input", () => {
    const inputs = ["", "null", "{}", "undefined", "true", "123"];
    for (const text of inputs) {
      expect(() => parseSamplingResponse(makeResponse(text))).not.toThrow();
    }
  });
});
