import { describe, it, expect } from "vitest";
import {
  MAX_SCOPE_CHARS,
  extractVaultScopeFromFrontmatter,
} from "./vault-scope.js";

describe("extractVaultScopeFromFrontmatter", () => {
  it("extracts vault_scope from valid frontmatter", () => {
    const content = `---
schema_version: 1
generated_by: mcp-markdown-vault
generated_at: 2026-01-15T10:00:00.000Z
managed_by: auto
vault_scope: "12 markdown files in notes/, projects/"
---

# Vault Overview
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBe(
      "12 markdown files in notes/, projects/",
    );
  });

  it("extracts unquoted vault_scope", () => {
    const content = `---
vault_scope: my test vault
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBe("my test vault");
  });

  it("returns undefined when frontmatter is missing", () => {
    const content = "# No Frontmatter\n\nJust content.\n";
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when frontmatter has no vault_scope field", () => {
    const content = `---
schema_version: 1
managed_by: auto
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when vault_scope is empty string", () => {
    const content = `---
vault_scope: ""
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when vault_scope is whitespace only", () => {
    const content = `---
vault_scope: "   "
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when frontmatter is malformed YAML", () => {
    const content = `---
vault_scope: [unclosed
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when vault_scope is not a string", () => {
    const content = `---
vault_scope: 42
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("trims whitespace from extracted scope", () => {
    const content = `---
vault_scope: "  padded scope  "
---

# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBe("padded scope");
  });

  it("truncates scope exceeding MAX_SCOPE_CHARS", () => {
    const longScope = "a".repeat(MAX_SCOPE_CHARS + 50);
    const content = `---
vault_scope: "${longScope}"
---

# Content
`;
    const result = extractVaultScopeFromFrontmatter(content);
    expect(result).toHaveLength(MAX_SCOPE_CHARS);
    expect(result).toBe("a".repeat(MAX_SCOPE_CHARS));
  });

  it("returns undefined when closing --- is missing", () => {
    const content = `---
vault_scope: "orphan"
# Content
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });
});

describe("MAX_SCOPE_CHARS", () => {
  it("is a positive number", () => {
    expect(MAX_SCOPE_CHARS).toBeGreaterThan(0);
  });

  it("is 200", () => {
    expect(MAX_SCOPE_CHARS).toBe(200);
  });
});

describe("extractVaultScopeFromFrontmatter — schema v3 vault_scope field", () => {
  it("extracts vault_scope field from schema v3 frontmatter", () => {
    const content = `---
schema_version: 3
vault_scope: A research vault about distributed systems.
updated_at: '2026-01-15T10:00:00.000Z'
managed_by: host
---

# Vault Overview

A research vault about distributed systems.
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBe(
      "A research vault about distributed systems.",
    );
  });

  it("ignores overview field when vault_scope is absent", () => {
    const content = `---
schema_version: 3
overview: Full overview text is body content and not routing scope.
---

# Vault Overview
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when vault_scope is empty string", () => {
    const content = `---
schema_version: 3
vault_scope: ""
updated_at: '2026-01-15T10:00:00.000Z'
managed_by: host
---

# Vault Overview
`;
    expect(extractVaultScopeFromFrontmatter(content)).toBeUndefined();
  });
});
