import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { VaultOverviewService } from "./vault-overview.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overview-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("VaultOverviewService", () => {
  it("returns empty result for an empty vault", async () => {
    const adapter = await LocalFileSystemAdapter.create(tmpDir);
    const service = new VaultOverviewService(adapter);

    const result = await service.getOverview();

    expect(result.totalFiles).toBe(0);
    expect(result.folders).toEqual([]);
  });

  it("counts files in a flat vault", async () => {
    await fs.writeFile(path.join(tmpDir, "a.md"), "# A\n");
    await fs.writeFile(path.join(tmpDir, "b.md"), "# B\n");
    await fs.writeFile(path.join(tmpDir, "c.md"), "# C\n");

    const adapter = await LocalFileSystemAdapter.create(tmpDir);
    const service = new VaultOverviewService(adapter);

    const result = await service.getOverview();

    expect(result.totalFiles).toBe(3);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.path).toBe(".");
    expect(result.folders[0]!.fileCount).toBe(3);
  });

  it("builds tree and stops at depth limit", async () => {
    // Depth: 1/2/3/4 — at maxDepth=3 the level 4 folder should not appear
    await fs.mkdir(path.join(tmpDir, "l1/l2/l3/l4"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "l1/a.md"), "# A\n");
    await fs.writeFile(path.join(tmpDir, "l1/l2/b.md"), "# B\n");
    await fs.writeFile(path.join(tmpDir, "l1/l2/l3/c.md"), "# C\n");
    await fs.writeFile(path.join(tmpDir, "l1/l2/l3/l4/d.md"), "# D\n");

    const adapter = await LocalFileSystemAdapter.create(tmpDir);
    const service = new VaultOverviewService(adapter);

    const result = await service.getOverview(3);

    expect(result.totalFiles).toBe(4);

    // l1 is at level 1
    const l1 = result.folders.find((f) => f.path === "l1");
    expect(l1).toBeDefined();
    expect(l1!.fileCount).toBe(1);

    // l1/l2 at level 2
    const l2 = l1!.children.find((f) => f.path === "l1/l2");
    expect(l2).toBeDefined();
    expect(l2!.fileCount).toBe(1);

    // l1/l2/l3 at level 3
    const l3 = l2!.children.find((f) => f.path === "l1/l2/l3");
    expect(l3).toBeDefined();
    expect(l3!.fileCount).toBe(1);

    // l1/l2/l3/l4 at level 4 — should NOT be visible
    expect(l3!.children).toHaveLength(0);
  });

  it("lastModified points to the newest file in the directory", async () => {
    await fs.mkdir(path.join(tmpDir, "notes"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "notes/old.md"), "# Old\n");
    await fs.writeFile(path.join(tmpDir, "notes/new.md"), "# New\n");

    // Set different modification dates
    const oldDate = new Date("2024-01-01T00:00:00Z");
    const newDate = new Date("2025-06-15T12:00:00Z");
    await fs.utimes(path.join(tmpDir, "notes/old.md"), oldDate, oldDate);
    await fs.utimes(path.join(tmpDir, "notes/new.md"), newDate, newDate);

    const adapter = await LocalFileSystemAdapter.create(tmpDir);
    const service = new VaultOverviewService(adapter);

    const result = await service.getOverview();
    const notesFolder = result.folders.find((f) => f.path === "notes");

    expect(notesFolder).toBeDefined();
    expect(notesFolder!.lastModified).toBe(newDate.toISOString());
  });

  it("skips hidden directories and non-md files", async () => {
    await fs.mkdir(path.join(tmpDir, ".obsidian"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "node_modules/pkg"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "notes"), { recursive: true });

    await fs.writeFile(path.join(tmpDir, ".obsidian/workspace.md"), "hidden");
    await fs.writeFile(path.join(tmpDir, ".git/config.md"), "hidden");
    await fs.writeFile(path.join(tmpDir, "node_modules/pkg/readme.md"), "hidden");
    await fs.writeFile(path.join(tmpDir, "notes/visible.md"), "# Visible\n");
    await fs.writeFile(path.join(tmpDir, "image.png"), "binary"); // non-md

    const adapter = await LocalFileSystemAdapter.create(tmpDir);
    const service = new VaultOverviewService(adapter);

    const result = await service.getOverview();

    expect(result.totalFiles).toBe(1);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.path).toBe("notes");

    // No hidden directory should appear
    const allPaths = flattenPaths(result.folders);
    expect(allPaths).not.toContain(".obsidian");
    expect(allPaths).not.toContain(".git");
    expect(allPaths).not.toContain("node_modules");
    expect(allPaths).not.toContain("node_modules/pkg");
  });
});

/** Helper to collect all paths from the tree. */
function flattenPaths(folders: Array<{ path: string; children: Array<{ path: string; children: unknown[] }> }>): string[] {
  const result: string[] = [];
  for (const f of folders) {
    result.push(f.path);
    result.push(...flattenPaths(f.children as typeof folders));
  }
  return result;
}
