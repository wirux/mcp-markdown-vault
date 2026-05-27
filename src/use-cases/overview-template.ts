export function generateOverviewStub(timestamp: string, mode: "manual" | "assisted" = "manual"): string {
  if (mode === "assisted") {
    return `---
schema_version: 3
vault_scope: ""
updated_at: ${timestamp}
managed_by: host
---

# Vault Overview

<!-- Host-assisted overview. Call prepare_overview to gather evidence, then call save_overview with your generated text. -->
`;
  }

  return `---
schema_version: 3
vault_scope: ""
updated_at: ${timestamp}
managed_by: user
---

# Vault Overview

<!-- User-authored overview. Edit this file to describe your vault. The server never modifies this file after creation. -->
`;
}
