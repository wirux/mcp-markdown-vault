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
    expect(result).toMatch(/generated_at: '?2026-01-15T10:00:00\.000Z'?/);
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

  it("overwrites existing meta/overview.md stub on subsequent writeOverview calls", async () => {
    const { adapter } = await makeTempVault();
    // Simulate auto-init creating the stub first
    await adapter.writeNote(
      "meta/overview.md",
      "---\nschema_version: 1\nmanaged_by: auto\n---\n\n# Vault Overview\n\n<!-- stub -->\n",
    );
    // Add real content to the vault
    await adapter.writeNote("docs/note.md", "---\ntags: testing\n---\n# My Note\n");

    const manager = new OverviewManager({ fsAdapter: adapter });

    // This must NOT throw NoteAlreadyExistsError — it must overwrite
    await manager.writeOverview();

    const content = await adapter.readNote("meta/overview.md");
    expect(content).toContain("## Statistics");
    expect(content).toContain("- **Total files**: 1");
    expect(content).toContain("- `testing` (1)");
    expect(content).toContain("- My Note");
    expect(content).not.toContain("<!-- stub -->");
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

  it("uses deterministic fallback when no sampling provider is given", async () => {
    const { adapter } = await makeTempVault();
    for (let i = 0; i < 5; i++) {
      await adapter.writeNote(`notes/note${i}.md`, `# Note ${i}\n`);
    }
    const manager = new OverviewManager({ fsAdapter: adapter });
    const result = await manager.generate();
    expect(result).toContain("generation_source: deterministic");
    expect(result).toContain("vault_scope:");
    expect(result).toContain("vault_context:");
  });

  it("uses sampling output when provider returns valid response", async () => {
    const { adapter } = await makeTempVault();
    for (let i = 0; i < 5; i++) {
      await adapter.writeNote(`notes/note${i}.md`, `# Note ${i}\n`);
    }
    const mockProvider = {
      isAvailable: () => true,
      createMessage: async () => ({
        text: JSON.stringify({
          vault_scope: "Semantic scope from LLM",
          vault_context: "Semantic context from LLM",
        }),
      }),
    };
    const manager = new OverviewManager({
      fsAdapter: adapter,
      getSamplingProvider: () => mockProvider,
    });
    const result = await manager.generate();
    expect(result).toContain("generation_source: sampling");
    expect(result).toContain("Semantic scope from LLM");
    expect(result).toContain("Semantic context from LLM");
  });

  it("falls back to deterministic when sampling returns invalid JSON", async () => {
    const { adapter } = await makeTempVault();
    for (let i = 0; i < 5; i++) {
      await adapter.writeNote(`notes/note${i}.md`, `# Note ${i}\n`);
    }
    const mockProvider = {
      isAvailable: () => true,
      createMessage: async () => ({ text: "not valid json" }),
    };
    const manager = new OverviewManager({
      fsAdapter: adapter,
      getSamplingProvider: () => mockProvider,
    });
    const result = await manager.generate();
    expect(result).toContain("generation_source: deterministic");
  });

  it("skips sampling for small vault (fewer than 3 content files)", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "# A\n");
    await adapter.writeNote("notes/b.md", "# B\n");
    let samplingCalled = false;
    const mockProvider = {
      isAvailable: () => true,
      createMessage: async () => {
        samplingCalled = true;
        return { text: JSON.stringify({ vault_scope: "s", vault_context: "c" }) };
      },
    };
    const manager = new OverviewManager({
      fsAdapter: adapter,
      getSamplingProvider: () => mockProvider,
    });
    await manager.generate();
    expect(samplingCalled).toBe(false);
  });

  it("skips regeneration when evidence hash is unchanged", async () => {
    const { adapter } = await makeTempVault();
    for (let i = 0; i < 5; i++) {
      await adapter.writeNote(`notes/note${i}.md`, `# Note ${i}\n`);
    }
    const manager = new OverviewManager({ fsAdapter: adapter });
    await manager.writeOverview();
    let samplingCalled = false;
    const mockProvider = {
      isAvailable: () => true,
      createMessage: async () => {
        samplingCalled = true;
        return { text: JSON.stringify({ vault_scope: "s", vault_context: "c" }) };
      },
    };
    const manager2 = new OverviewManager({
      fsAdapter: adapter,
      getSamplingProvider: () => mockProvider,
    });
    await manager2.generate();
    expect(samplingCalled).toBe(false);
  });
});
