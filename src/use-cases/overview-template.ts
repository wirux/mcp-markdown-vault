export function generateOverviewStub(timestamp: string, mode: "auto" | "manual" = "manual"): string {
  if (mode === "auto") {
    return `---
schema_version: 1
generated_by: mcp-markdown-vault
generated_at: ${timestamp}
managed_by: auto
vault_scope: "general markdown notes vault"
---

# Vault Overview

<!-- This file is auto-generated. Manual edits will be overwritten on the next refresh. -->
`;
  }

  return `---
schema_version: 1
generated_by: mcp-markdown-vault
generated_at: ${timestamp}
managed_by: user
vault_scope: "describe your vault contents here"
---

# Vault Overview

<!-- Free-form narrative about this vault's current contents and state.
     Fully user-controlled — the server never modifies this file after creation.
     Edit vault_scope above to set the one-line description shown to MCP hosts. -->
`;
}
