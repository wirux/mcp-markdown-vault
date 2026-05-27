import { createHash } from "node:crypto";
import yaml from "js-yaml";

/**
 * Canonical evidence shape collected from vault notes.
 * Used as the input to computeEvidenceHash() and as the prompt payload for sampling.
 */
export interface VaultEvidence {
  totalFiles: number;
  directories: string[];
  tags: string[];
  titles: string[];
}

/**
 * Computes a deterministic SHA-256 hex digest of vault evidence.
 * Arrays are sorted internally so insertion order does not affect the hash.
 * Returns a 64-character lowercase hex string.
 */
export function computeEvidenceHash(evidence: VaultEvidence): string {
  const normalized = {
    totalFiles: evidence.totalFiles,
    directories: [...evidence.directories].sort(),
    tags: [...evidence.tags].sort(),
    titles: [...evidence.titles].sort(),
  };
  const payload = JSON.stringify(normalized);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Extracts the stored `evidence_hash` field from overview.md frontmatter.
 * Returns undefined if the field is missing, malformed, or the frontmatter cannot be parsed.
 */
export function extractStoredHash(content: string): string | undefined {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return undefined;
  }

  const closingIndex = content.indexOf("\n---\n", 4);
  const closingIndexAlt = content.indexOf("\n---\r\n", 4);
  const endIdx =
    closingIndex !== -1
      ? closingIndex
      : closingIndexAlt !== -1
        ? closingIndexAlt
        : -1;

  if (endIdx === -1) {
    return undefined;
  }

  const frontmatterRaw = content.slice(4, endIdx);

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatterRaw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }

  const hash = (parsed as Record<string, unknown>)["evidence_hash"];
  if (typeof hash !== "string") {
    return undefined;
  }

  const trimmed = hash.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
