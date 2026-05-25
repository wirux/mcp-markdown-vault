import yaml from "js-yaml";

/**
 * Maximum length for the one-line vault scope string.
 * Used in both generation and extraction to enforce a strict cap.
 */
export const MAX_SCOPE_CHARS = 200;

/**
 * Extracts the `vault_scope` field from overview.md frontmatter.
 * Returns `undefined` if frontmatter is missing, malformed, or the field is absent/empty.
 */
export function extractVaultScopeFromFrontmatter(content: string): string | undefined {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return undefined;
  }

  const closingIndex = content.indexOf("\n---\n", 4);
  const closingIndexAlt = content.indexOf("\n---\r\n", 4);
  const endIdx = closingIndex !== -1
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

  const scope = (parsed as Record<string, unknown>)["vault_scope"];
  if (typeof scope !== "string") {
    return undefined;
  }

  const trimmed = scope.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_SCOPE_CHARS);
}

interface VaultScopeData {
  totalFiles: number;
  directories: Array<{ name: string; fileCount: number }>;
  tags: Array<{ name: string; count: number }>;
}

/**
 * Generates a deterministic one-line vault scope description from vault statistics.
 * Always returns a non-empty string capped at MAX_SCOPE_CHARS.
 */
export function generateVaultScope(data: VaultScopeData): string {
  const parts: string[] = [];

  parts.push(`${data.totalFiles} markdown files`);

  const topDirs = data.directories.slice(0, 4);
  if (topDirs.length > 0) {
    const dirNames = topDirs.map((d) => `${d.name}/`).join(", ");
    parts.push(`in ${dirNames}`);
  }

  const topTags = data.tags.slice(0, 4);
  if (topTags.length > 0) {
    const tagNames = topTags.map((t) => t.name).join(", ");
    parts.push(`topics: ${tagNames}`);
  }

  const joined = parts.join(" — ");

  if (joined.length <= MAX_SCOPE_CHARS) {
    return joined;
  }

  // Truncate cleanly at word boundary if possible
  const truncated = joined.slice(0, MAX_SCOPE_CHARS - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > MAX_SCOPE_CHARS * 0.6) {
    return truncated.slice(0, lastSpace) + "…";
  }

  return truncated + "…";
}
