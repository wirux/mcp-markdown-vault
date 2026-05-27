import { describe, it, expect } from "vitest";
import { generateOverviewStub } from "./overview-template.js";

describe("generateOverviewStub", () => {
  const ts = "2026-01-15T10:00:00.000Z";

  it("includes schema_version: 3 in frontmatter", () => {
    expect(generateOverviewStub(ts)).toContain("schema_version: 3");
  });

  it("includes vault_scope field in frontmatter", () => {
    expect(generateOverviewStub(ts)).toContain('vault_scope: ""');
  });

  it("includes updated_at matching the timestamp param", () => {
    expect(generateOverviewStub(ts)).toContain(`updated_at: ${ts}`);
  });

  it("includes managed_by: user for manual mode (default)", () => {
    expect(generateOverviewStub(ts)).toContain("managed_by: user");
    expect(generateOverviewStub(ts, "manual")).toContain("managed_by: user");
  });

  it("includes managed_by: host for assisted mode", () => {
    expect(generateOverviewStub(ts, "assisted")).toContain("managed_by: host");
  });

  it("manual stub contains user-authored notice", () => {
    const result = generateOverviewStub(ts, "manual");
    expect(result).toContain("User-authored overview");
  });

  it("assisted stub contains host-assisted notice", () => {
    const result = generateOverviewStub(ts, "assisted");
    expect(result).toContain("Host-assisted overview");
  });

  it("includes the main heading", () => {
    expect(generateOverviewStub(ts)).toContain("# Vault Overview");
  });

  it("does NOT include full overview field in frontmatter", () => {
    expect(generateOverviewStub(ts)).not.toContain("overview:");
    expect(generateOverviewStub(ts, "assisted")).not.toContain("overview:");
  });

  it("does NOT include legacy evidence_hash field", () => {
    expect(generateOverviewStub(ts)).not.toContain("evidence_hash");
  });

  it("does NOT include legacy generated_by field", () => {
    expect(generateOverviewStub(ts)).not.toContain("generated_by");
  });

  it("different timestamps produce different updated_at values", () => {
    const r1 = generateOverviewStub("2026-01-01T00:00:00.000Z");
    const r2 = generateOverviewStub("2026-06-01T00:00:00.000Z");
    expect(r1).toContain("2026-01-01T00:00:00.000Z");
    expect(r2).toContain("2026-06-01T00:00:00.000Z");
  });
});
