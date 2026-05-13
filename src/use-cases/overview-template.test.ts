import { describe, it, expect } from "vitest";
import { generateOverviewStub } from "./overview-template.js";

describe("generateOverviewStub", () => {
  const ts = "2026-01-15T10:00:00.000Z";

  it("includes schema_version: 1 in frontmatter", () => {
    expect(generateOverviewStub(ts)).toContain("schema_version: 1");
  });

  it("includes generated_by: mcp-markdown-vault in frontmatter", () => {
    expect(generateOverviewStub(ts)).toContain("generated_by: mcp-markdown-vault");
  });

  it("includes managed_by: user in frontmatter for manual mode (default)", () => {
    expect(generateOverviewStub(ts)).toContain("managed_by: user");
    expect(generateOverviewStub(ts, "manual")).toContain("managed_by: user");
  });

  it("includes managed_by: auto in frontmatter for auto mode", () => {
    expect(generateOverviewStub(ts, "auto")).toContain("managed_by: auto");
  });

  it("auto mode stub contains auto-generated notice", () => {
    const result = generateOverviewStub(ts, "auto");
    expect(result).toContain("auto-generated");
  });

  it("manual mode stub contains user-controlled notice", () => {
    const result = generateOverviewStub(ts, "manual");
    expect(result).toContain("user-controlled");
  });

  it("includes generated_at matching the timestamp param", () => {
    expect(generateOverviewStub(ts)).toContain(`generated_at: ${ts}`);
  });

  it("includes the main heading", () => {
    expect(generateOverviewStub(ts)).toContain("# Vault Overview");
  });

  it("different timestamps produce different generated_at values", () => {
    const r1 = generateOverviewStub("2026-01-01T00:00:00.000Z");
    const r2 = generateOverviewStub("2026-06-01T00:00:00.000Z");
    expect(r1).toContain("2026-01-01T00:00:00.000Z");
    expect(r2).toContain("2026-06-01T00:00:00.000Z");
  });
});
