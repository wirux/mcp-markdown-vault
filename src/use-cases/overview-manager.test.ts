import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { OverviewManager } from "./overview-manager.js";

const tmpDirs: string[] = [];
const FS_PROMISES_MODULE = "node:fs/promises";
const OS_MODULE = "node:os";
const PATH_MODULE = "node:path";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  const { rm } = await import(FS_PROMISES_MODULE);
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempVault() {
  const [{ mkdtemp, realpath }, os, path] = await Promise.all([
    import(FS_PROMISES_MODULE),
    import(OS_MODULE),
    import(PATH_MODULE),
  ]);
  const tmpPath = await mkdtemp(path.join(os.tmpdir(), "overview-manager-test-"));
  const vaultPath = await realpath(tmpPath);
  tmpDirs.push(vaultPath);
  const adapter = await LocalFileSystemAdapter.create(vaultPath);
  return { adapter, vaultPath };
}

describe("OverviewManager — getStatus", () => {
  it("returns missing when no overview file exists", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    const status = await manager.getStatus();

    expect(status.status).toBe("missing");
    expect(status.managed_by).toBeNull();
    expect(status.updated_at).toBeNull();
  });

  it("returns present when overview file exists with frontmatter", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote(
      "meta/overview.md",
      '---\nschema_version: 3\nvault_scope: ""\nupdated_at: \'2026-01-15T10:00:00.000Z\'\nmanaged_by: host\n---\n\n# Vault Overview\n',
    );
    const manager = new OverviewManager({ fsAdapter: adapter });

    const status = await manager.getStatus();

    expect(status.status).toBe("present");
    expect(status.managed_by).toBe("host");
    expect(status.updated_at).toBe("2026-01-15T10:00:00.000Z");
  });

  it("returns present when overview file has non-empty vault_scope field", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote(
      "meta/overview.md",
      "---\nschema_version: 3\nvault_scope: A research vault.\nupdated_at: '2026-01-15T10:00:00.000Z'\nmanaged_by: host\n---\n\n# Vault Overview\n\nA research vault.\n",
    );
    const manager = new OverviewManager({ fsAdapter: adapter });

    const status = await manager.getStatus();

    expect(status.status).toBe("present");
    expect(status.managed_by).toBe("host");
    expect(status.updated_at).toBe("2026-01-15T10:00:00.000Z");
  });
});

describe("OverviewManager — readOverview", () => {
  it("returns null when no overview file exists", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    const result = await manager.readOverview();

    expect(result).toBeNull();
  });

  it("returns file content when overview exists", async () => {
    const { adapter } = await makeTempVault();
    const content = "---\nschema_version: 3\nvault_scope: test\nupdated_at: '2026-01-15T10:00:00.000Z'\nmanaged_by: host\n---\n\n# Vault Overview\n\ntest\n";
    await adapter.writeNote("meta/overview.md", content);
    const manager = new OverviewManager({ fsAdapter: adapter });

    const result = await manager.readOverview();

    expect(result).toBe(content);
  });
});

describe("OverviewManager — saveOverview", () => {
  it("writes schema_version:3 frontmatter with dedicated scope and managed_by:host", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    await manager.saveOverview(
      "A research vault about distributed systems.",
      "Distributed systems design decisions and architecture notes.",
    );

    const content = await adapter.readNote("meta/overview.md");
    expect(content).toContain("schema_version: 3");
    expect(content).toContain("vault_scope: Distributed systems design decisions and architecture notes.");
    expect(content).toContain("managed_by: host");
    expect(content).toContain("updated_at: '2026-01-15T10:00:00.000Z'");
    expect(content).toContain("A research vault about distributed systems.");
  });

  it("caps vault_scope at 200 chars regardless of input length", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });
    const longScope = "A ".repeat(150).trim();

    await manager.saveOverview("Full overview body.", longScope);

    const content = await adapter.readNote("meta/overview.md");
    const frontmatter = content.slice(0, content.indexOf("\n---\n", 4));
    const scopeLine = frontmatter.split("\n").find((line) => line.startsWith("vault_scope:"));
    expect(scopeLine).toBeDefined();
    // YAML quoting adds some chars but the actual value is capped at 200
    const rawValue = content.match(/vault_scope:\s*'?([^'\n]+)/)?.[1] ?? "";
    expect(rawValue.length).toBeLessThanOrEqual(200);
    expect(content).toContain("Full overview body.");
  });

  it("does not include evidence_hash, vault_context, or generation_source", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    await manager.saveOverview("A test vault.", "Test routing hint.");

    const content = await adapter.readNote("meta/overview.md");
    expect(content).not.toContain("evidence_hash");
    expect(content).not.toContain("vault_context");
    expect(content).not.toContain("generation_source");
  });

  it("overwrites existing overview file", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote(
      "meta/overview.md",
      "---\nschema_version: 2\nmanaged_by: auto\n---\n\n# Old Overview\n",
    );
    const manager = new OverviewManager({ fsAdapter: adapter });

    await manager.saveOverview("New overview text.", "New scope.");

    const content = await adapter.readNote("meta/overview.md");
    expect(content).toContain("schema_version: 3");
    expect(content).toContain("New overview text.");
    expect(content).not.toContain("schema_version: 2");
    expect(content).not.toContain("managed_by: auto");
  });

  it("after save, getStatus returns present", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    await manager.saveOverview("A vault for testing.", "Testing scope.");

    const status = await manager.getStatus();
    expect(status.status).toBe("present");
    expect(status.managed_by).toBe("host");
  });
});

describe("OverviewManager — gatherEvidence", () => {
  it("returns fileCount, directories, tags, recentTitles", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "---\ntags:\n  - alpha\n---\n# Alpha\n");
    await adapter.writeNote("notes/b.md", "---\ntags:\n  - beta\n---\n# Beta\n");
    await adapter.writeNote("projects/c.md", "---\ntags:\n  - alpha\n---\n# Project C\n");
    const manager = new OverviewManager({ fsAdapter: adapter });

    const evidence = await manager.gatherEvidence();

    expect(evidence.fileCount).toBe(3);
    expect(evidence.directories).toContain("notes");
    expect(evidence.directories).toContain("projects");
    expect(evidence.tags).toContain("alpha");
    expect(evidence.tags).toContain("beta");
    expect(Array.isArray(evidence.recentTitles)).toBe(true);
  });

  it("excludes meta directory from evidence", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "---\ntags: visible\n---\n# Visible\n");
    await adapter.writeNote("meta/overview.md", "---\ntags: hidden\n---\n# Hidden\n");
    const manager = new OverviewManager({ fsAdapter: adapter });

    const evidence = await manager.gatherEvidence();

    expect(evidence.fileCount).toBe(1);
    expect(evidence.directories).not.toContain("meta");
    expect(evidence.tags).not.toContain("hidden");
  });

  it("does not write any files", async () => {
    const { adapter, vaultPath } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "# A\n");
    const manager = new OverviewManager({ fsAdapter: adapter });

    const { readdir } = await import(FS_PROMISES_MODULE);
    const before = await readdir(vaultPath, { recursive: true });
    await manager.gatherEvidence();
    const after = await readdir(vaultPath, { recursive: true });

    expect(after.length).toBe(before.length);
  });
});
