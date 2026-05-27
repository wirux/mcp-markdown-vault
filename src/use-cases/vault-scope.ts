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

  const fm = parsed as Record<string, unknown>;
  const scope = fm["vault_scope"];
  if (typeof scope !== "string") {
    return undefined;
  }

  const trimmed = scope.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_SCOPE_CHARS);
}
