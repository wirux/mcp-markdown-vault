import { sanitizeForMarkdown } from "./markdown-utils.js";

const MAX_INSTRUCTIONS_LENGTH = 2048;

export function composeInstructions(vaultScope: string): string {
  const safeScope = sanitizeForMarkdown(vaultScope.trim() || "general markdown notes vault");

  const instructions = `Headless markdown vault MCP server. Vault scope: ${safeScope}.

Tool dispatchers (action-based — pass \`action\` parameter to each):
- view: read and search content (search, semantic_search, global_search, outline, read, frontmatter_get, bulk_read, backlinks)
- vault: CRUD on .md files (list, read, create, update, delete, stat, create_from_template)
- edit: surgical AST-based modifications (append, prepend, replace, line_replace, string_replace, frontmatter_set; supports dryRun)
- workflow: Petri-net state machine (status, transition, history, reset)
- system: server status (status, reindex)

For full vault conventions (directory layout, frontmatter schema, tag conventions, search hints), read the \`vault://overview\` resource if your client supports MCP resources, or check \`meta/overview.md\` and \`meta/contract.md\` directly via \`view\` action=\`read\`.

Search guidance: use \`semantic_search\` for conceptual or fuzzy queries, \`global_search\` for exact phrases, \`outline\` for structure exploration before search.`;

  if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    return instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);
  }
  return instructions;
}
