import { MAX_SCOPE_CHARS } from "./vault-scope.js";
import type { VaultEvidence } from "./evidence-hash.js";
import type { SamplingRequest, SamplingResponse } from "../domain/interfaces/sampling-provider.js";

export const SAMPLING_MAX_TOKENS = 300;
export const SAMPLING_TIMEOUT_MS = 30_000;
export const MAX_CONTEXT_CHARS = 500;

const SYSTEM_PROMPT =
  "You are a vault orientation assistant. Analyze the provided vault evidence and return a JSON object with exactly two fields: " +
  '"vault_scope" (a short one-line routing hint, max 200 chars) and ' +
  '"vault_context" (a semantic overview of what the vault is about, max 500 chars). ' +
  "Return only valid JSON with no markdown fences or extra text.";

export function buildSamplingPrompt(evidence: VaultEvidence): SamplingRequest {
  const userMessage = JSON.stringify({
    totalFiles: evidence.totalFiles,
    directories: evidence.directories,
    tags: evidence.tags,
    titles: evidence.titles,
  });

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: SAMPLING_MAX_TOKENS,
    timeoutMs: SAMPLING_TIMEOUT_MS,
  };
}

export type ParseSuccess = {
  ok: true;
  vault_scope: string;
  vault_context: string;
};

export type ParseFailure = {
  ok: false;
  reason: string;
};

export type ParseResult = ParseSuccess | ParseFailure;

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.6) {
    return truncated.slice(0, lastSpace) + "\u2026";
  }
  return truncated + "\u2026";
}

export function parseSamplingResponse(response: SamplingResponse): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return { ok: false, reason: "response is not valid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "response is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;

  const rawScope = obj["vault_scope"];
  const rawContext = obj["vault_context"];

  if (typeof rawScope !== "string" || rawScope.trim().length === 0) {
    return { ok: false, reason: "vault_scope is missing or empty" };
  }

  if (typeof rawContext !== "string" || rawContext.trim().length === 0) {
    return { ok: false, reason: "vault_context is missing or empty" };
  }

  return {
    ok: true,
    vault_scope: truncateAtWordBoundary(rawScope.trim(), MAX_SCOPE_CHARS),
    vault_context: truncateAtWordBoundary(rawContext.trim(), MAX_CONTEXT_CHARS),
  };
}
