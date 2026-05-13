import { describe, it, expect } from "vitest";
import { generateContractTemplate } from "./contract-template.js";

describe("generateContractTemplate", () => {
  const ts = "2026-01-15T10:00:00.000Z";

  it("includes schema_version: 1 in frontmatter", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("schema_version: 1");
  });

  it("includes generated_by: mcp-markdown-vault in frontmatter", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("generated_by: mcp-markdown-vault");
  });

  it("includes generated_at matching the provided timestamp", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain(`generated_at: ${ts}`);
  });

  it("includes the main heading", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("# Vault Contract");
  });

  it("includes all 5 section headings", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("## Frontmatter Schema");
    expect(result).toContain("## Tag Conventions");
    expect(result).toContain("## Search Hints");
    expect(result).toContain("## Naming Conventions");
    expect(result).toContain("## Note Template");
  });

  it("does NOT include redundant sections covered by tools", () => {
    const result = generateContractTemplate(ts);
    // Scope → covered by VAULT_CONTEXT env var + overview.md
    // Directory Layout → covered by view.outline + vault://stats
    // Workflow States → covered by workflow.status tool
    expect(result).not.toMatch(/^## Scope$/m);
    expect(result).not.toContain("## Directory Layout");
    expect(result).not.toContain("## Workflow States");
  });

  it("mentions Scope option in HTML comment for power users", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("## Scope");
    expect(result).toContain("Power users");
  });

  it("does not use vaultContext in output (no Scope section)", () => {
    const result = generateContractTemplate(ts);
    expect(result).not.toContain("my custom scope");
  });

  it("includes HTML comments as inline guidance", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("<!--");
    expect(result).toContain("-->");
  });

  it("Search Hints section contains all search action recommendations", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("semantic_search");
    expect(result).toContain("global_search");
    expect(result).toContain("view.read");
    expect(result).toContain("view.outline");
    expect(result).toContain("view.frontmatter_get");
    expect(result).toContain("view.backlinks");
    expect(result).toContain("view.bulk_read");
  });

  it("different timestamps produce different generated_at values", () => {
    const r1 = generateContractTemplate("2026-01-01T00:00:00.000Z");
    const r2 = generateContractTemplate("2026-06-01T00:00:00.000Z");
    expect(r1).toContain("2026-01-01T00:00:00.000Z");
    expect(r2).toContain("2026-06-01T00:00:00.000Z");
  });

  it("includes pre-filled frontmatter schema with practical defaults", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("`title`: string");
    expect(result).toContain("`tags`: string[]");
    expect(result).toContain("`type`: enum");
    expect(result).toContain("`created`: ISO 8601 date");
    expect(result).toContain("`status`: enum");
  });

  it("includes pre-filled tag conventions", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("hyphen-separated");
    expect(result).toContain("Hierarchical");
  });

  it("includes pre-filled naming conventions with length constraint", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("kebab-case.md");
    expect(result).toContain("2–5 words");
    expect(result).toContain("no prefixes");
  });

  it("includes a Note Template section with markdown scaffold", () => {
    const result = generateContractTemplate(ts);
    expect(result).toContain("## Note Template");
    expect(result).toContain("title: {{Title}}");
    expect(result).toContain("tags: []");
    expect(result).toContain("type: note");
    expect(result).toContain("status: draft");
    expect(result).toContain("## Context");
    expect(result).toContain("## Content");
  });
});
