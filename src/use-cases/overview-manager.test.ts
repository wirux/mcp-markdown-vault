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

describe("OverviewManager", () => {
  it("generate returns managed_by auto frontmatter", async () => {
    const { adapter } = await makeTempVault();
    const manager = new OverviewManager({ fsAdapter: adapter });

    const result = await manager.generate();

    expect(result).toContain("managed_by: auto");
    expect(result).toContain("generated_at: 2026-01-15T10:00:00.000Z");
  });

  it("includes directory listing with correct counts and tag frequencies", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote(
      "notes/a.md",
      "---\ntags:\n  - alpha\n  - beta\n---\n# Alpha\n",
    );
    await adapter.writeNote(
      "notes/b.md",
      "---\ntags: alpha, gamma\n---\n# Beta\n",
    );
    await adapter.writeNote(
      "projects/c.md",
      "---\ntags:\n  - beta\n---\n# Project C\n",
    );

    const manager = new OverviewManager({ fsAdapter: adapter });
    const result = await manager.generate();

    expect(result).toContain("- **Total files**: 3");
    expect(result).toContain("- **Directories**: 2");
    expect(result).toContain("- `notes/` — 2 files");
    expect(result).toContain("- `projects/` — 1 files");
    expect(result).toContain("- `alpha` (2)");
    expect(result).toContain("- `beta` (2)");
    expect(result).toContain("- `gamma` (1)");
  });

  it("excludes meta directory from counts and scans", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "---\ntags: visible\n---\n# Visible\n");
    await adapter.writeNote("meta/overview.md", "---\ntags: hidden\n---\n# Hidden\n");

    const manager = new OverviewManager({ fsAdapter: adapter });
    const result = await manager.generate();

    expect(result).toContain("- **Total files**: 1");
    expect(result).toContain("- **Directories**: 1");
    expect(result).toContain("- `notes/` — 1 files");
    expect(result).toContain("- `visible` (1)");
    expect(result).not.toContain("hidden");
    expect(result).not.toContain("meta/");
  });

  it("returns deterministic structure for repeated calls", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("b.md", "# Bee\n");
    await adapter.writeNote("a.md", "# Aye\n");
    const manager = new OverviewManager({ fsAdapter: adapter });

    const first = await manager.generate();
    const second = await manager.generate();

    expect(second).toBe(first);
    expect(first).toContain("- Aye");
    expect(first).toContain("- Bee");
  });

  it("writes overview to meta overview file", async () => {
    const { adapter, vaultPath } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "# Written\n");
    const manager = new OverviewManager({ fsAdapter: adapter });

    await manager.writeOverview();

    const [{ readFile }, path] = await Promise.all([
      import(FS_PROMISES_MODULE),
      import(PATH_MODULE),
    ]);
    const written = await readFile(path.join(vaultPath, "meta/overview.md"), "utf8");
    expect(written).toContain("# Vault Overview");
    expect(written).toContain("- Written");
  });

  it("shouldRefresh uses default threshold of five", () => {
    const manager = new OverviewManager({
      fsAdapter: {
        listNotes: async () => [],
        readNote: async () => "",
        writeNote: async () => undefined,
        deleteNote: async () => undefined,
        exists: async () => false,
        stat: async () => ({ sizeBytes: 0, modifiedAt: "2026-01-15T10:00:00.000Z" }),
      },
    });

    expect(manager.shouldRefresh(4)).toBe(false);
    expect(manager.shouldRefresh(5)).toBe(true);
  });

  it("skips unreadable files while still collecting available data", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "---\ntags: kept\n---\n# Kept\n");
    await adapter.writeNote("notes/b.md", "---\ntags: missing\n---\n# Missing\n");

    const manager = new OverviewManager({
      fsAdapter: {
        listNotes: adapter.listNotes.bind(adapter),
        readNote: async (notePath: string) => {
          if (notePath === "notes/b.md") {
            throw new Error("boom");
          }

          return adapter.readNote(notePath);
        },
        writeNote: adapter.writeNote.bind(adapter),
        deleteNote: adapter.deleteNote.bind(adapter),
        exists: adapter.exists.bind(adapter),
        stat: adapter.stat.bind(adapter),
      },
    });

    const result = await manager.generate();

    expect(result).toContain("- `kept` (1)");
    expect(result).not.toContain("missing");
    expect(result).toContain("- Kept");
  });
});
