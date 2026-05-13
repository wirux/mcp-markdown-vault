export function generateOverviewStub(timestamp: string, mode: "auto" | "manual" = "manual"): string {
  if (mode === "auto") {
    return `---
schema_version: 1
generated_by: mcp-markdown-vault
generated_at: ${timestamp}
managed_by: auto
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
---

# Vault Overview

<!-- Free-form narrative about this vault's current contents and state.
     Fully user-controlled — the server never modifies this file after creation.
     Leave empty if you don't want to maintain it manually. -->
`;
}
