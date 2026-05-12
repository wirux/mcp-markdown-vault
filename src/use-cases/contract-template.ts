export function generateContractTemplate(
  _vaultContext: string,
  timestamp: string,
): string {
  return `---
schema_version: 1
generated_by: mcp-markdown-vault
generated_at: ${timestamp}
---

# Vault Contract

<!-- Edit freely. The server creates this file once and never overwrites it.
     Connected agents read it to route queries and choose tool actions.
     Power users: add ## Scope here for a richer vault description visible to agents. -->

## Frontmatter Schema

<!-- Used by view.frontmatter_get and edit.frontmatter_set. -->

- \`title\`: string — note title
- \`tags\`: string[] — categorization tags (e.g. \`[research, draft]\`)
- \`type\`: enum — \`note\` | \`reference\` | \`log\` | \`template\`
- \`created\`: ISO 8601 date — creation timestamp
- \`updated\`: ISO 8601 date — last modification timestamp
- \`status\`: enum — \`draft\` | \`in_progress\` | \`done\`

## Tag Conventions

- Lowercase, hyphen-separated: \`machine-learning\`, \`project-alpha\`
- Hierarchical via \`/\` separator: \`lang/python\`, \`lang/typescript\`

## Search Hints

- Conceptual / fuzzy queries → \`view.semantic_search\`
- Exact phrases or regex patterns → \`view.global_search\`
- Reading a specific section → \`view.read\` with \`heading\` parameter
- Structure overview → \`view.outline\`
- YAML metadata → \`view.frontmatter_get\`
- Incoming links to a note → \`view.backlinks\`
- Reading multiple files at once → \`view.bulk_read\`

## Naming Conventions

- Files: \`kebab-case.md\`, 2–5 words, no prefixes (e.g. \`project-plan.md\`, not \`note-project-plan.md\`)
- Directories: \`kebab-case/\` (e.g. \`daily-notes/\`, \`project-docs/\`)

## Note Template

<!-- Default structure for new notes. Agents use this when creating files
     via vault.create. Customize to match your preferred note format. -->

\`\`\`markdown
---
title: {{Title}}
tags: []
type: note
created: {{YYYY-MM-DD}}
status: draft
---

# {{Title}}

## Context

{{What problem or topic this note addresses.}}

## Content

{{Main body of the note.}}
\`\`\`
`;
}
