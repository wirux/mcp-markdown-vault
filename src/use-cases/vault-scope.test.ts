import { describe, it, expect } from "vitest";
import {
  MAX_SCOPE_CHARS,
  extractVaultScopeFromFrontmatter,
  generateVaultScope,
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

describe("generateVaultScope", () => {
  it("generates scope from directories and tags", () => {
    const result = generateVaultScope({
      totalFiles: 42,
      directories: [
        { name: "notes", fileCount: 20 },
        { name: "projects", fileCount: 15 },
      ],
      tags: [
        { name: "typescript", count: 10 },
        { name: "architecture", count: 8 },
      ],
    });

    expect(result).toContain("42 markdown files");
    expect(result).toContain("notes/");
    expect(result).toContain("projects/");
    expect(result).toContain("typescript");
    expect(result).toContain("architecture");
  });

  it("handles empty directories and tags", () => {
    const result = generateVaultScope({
      totalFiles: 3,
      directories: [],
      tags: [],
    });

    expect(result).toBe("3 markdown files");
  });

  it("limits directories to 4", () => {
    const result = generateVaultScope({
      totalFiles: 100,
      directories: [
        { name: "a", fileCount: 30 },
        { name: "b", fileCount: 25 },
        { name: "c", fileCount: 20 },
        { name: "d", fileCount: 15 },
        { name: "e", fileCount: 10 },
      ],
      tags: [],
    });

    expect(result).toContain("a/");
    expect(result).toContain("d/");
    expect(result).not.toContain("e/");
  });

  it("limits tags to 4", () => {
    const result = generateVaultScope({
      totalFiles: 50,
      directories: [],
      tags: [
        { name: "t1", count: 10 },
        { name: "t2", count: 9 },
        { name: "t3", count: 8 },
        { name: "t4", count: 7 },
        { name: "t5", count: 6 },
      ],
    });

    expect(result).toContain("t4");
    expect(result).not.toContain("t5");
  });

  it("never exceeds MAX_SCOPE_CHARS", () => {
    const result = generateVaultScope({
      totalFiles: 9999,
      directories: Array.from({ length: 10 }, (_, i) => ({
        name: "very-long-directory-name-" + "x".repeat(20) + i,
        fileCount: 100,
      })),
      tags: Array.from({ length: 10 }, (_, i) => ({
        name: "long-tag-name-" + "y".repeat(20) + i,
        count: 50,
      })),
    });

    expect(result.length).toBeLessThanOrEqual(MAX_SCOPE_CHARS);
  });

  it("returns single-line string (no newlines)", () => {
    const result = generateVaultScope({
      totalFiles: 10,
      directories: [{ name: "docs", fileCount: 5 }],
      tags: [{ name: "test", count: 3 }],
    });

    expect(result).not.toContain("\n");
  });

  it("is deterministic for same input", () => {
    const data = {
      totalFiles: 25,
      directories: [
        { name: "notes", fileCount: 15 },
        { name: "archive", fileCount: 10 },
      ],
      tags: [
        { name: "daily", count: 12 },
        { name: "meeting", count: 8 },
      ],
    };

    expect(generateVaultScope(data)).toBe(generateVaultScope(data));
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
