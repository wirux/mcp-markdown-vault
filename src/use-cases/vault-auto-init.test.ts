import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { VaultAutoInitService } from "./vault-auto-init.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempVault() {
  const tmpPath = await mkdtemp(join(tmpdir(), "vault-auto-init-test-"));
  const vaultPath = await realpath(tmpPath);
  tmpDirs.push(vaultPath);
  const adapter = await LocalFileSystemAdapter.create(vaultPath);
  return { adapter };
}

describe("VaultAutoInitService", () => {
  it("creates both meta files in empty vault", async () => {
    const { adapter } = await makeTempVault();
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(true);
    expect(result.overviewCreated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await adapter.exists("meta/contract.md")).toBe(true);
    expect(await adapter.exists("meta/overview.md")).toBe(true);
  });

  it("emits warning when vault has existing .md files but no contract.md", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/existing.md", "# Existing");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("non-empty vault");
  });

  it("does not overwrite existing contract.md", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/contract.md", "# My Custom Contract");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(false);
    const content = await adapter.readNote("meta/contract.md");
    expect(content).toBe("# My Custom Contract");
  });

  it("does not overwrite existing overview.md", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/overview.md", "# My Overview");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.overviewCreated).toBe(false);
    const content = await adapter.readNote("meta/overview.md");
    expect(content).toBe("# My Overview");
  });

  it("returns both false when both files already exist", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/contract.md", "contract");
    await adapter.writeNote("meta/overview.md", "overview");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(false);
    expect(result.overviewCreated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("creates only overview when contract already exists", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/contract.md", "contract");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(false);
    expect(result.overviewCreated).toBe(true);
  });

  it("creates only contract when overview already exists", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/overview.md", "overview");
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(true);
    expect(result.overviewCreated).toBe(false);
  });

  it("generated contract contains expected structure", async () => {
    const { adapter } = await makeTempVault();
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    await service.initialize();
    const content = await adapter.readNote("meta/contract.md");
    expect(content).toContain("# Vault Contract");
    expect(content).toContain("## Frontmatter Schema");
    expect(content).toContain("## Note Template");
  });

  it("generated overview contains managed_by: user in frontmatter", async () => {
    const { adapter } = await makeTempVault();
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    await service.initialize();
    const content = await adapter.readNote("meta/overview.md");
    expect(content).toContain("managed_by: user");
  });

  it("is idempotent — running twice does not throw or corrupt", async () => {
    const { adapter } = await makeTempVault();
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    await service.initialize();
    const result2 = await service.initialize();
    expect(result2.contractCreated).toBe(false);
    expect(result2.overviewCreated).toBe(false);
  });

  it("handles write failure gracefully — returns false without throwing", async () => {
    const { adapter } = await makeTempVault();
    const brokenAdapter = {
      ...adapter,
      exists: async () => false,
      writeNote: async () => { throw new Error("EROFS: read-only file system"); },
      listNotes: async () => [],
      readNote: adapter.readNote.bind(adapter),
      deleteNote: adapter.deleteNote.bind(adapter),
      stat: adapter.stat.bind(adapter),
    };
    const service = new VaultAutoInitService({ fsAdapter: brokenAdapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.contractCreated).toBe(false);
    expect(result.overviewCreated).toBe(false);
  });

  it("no warning emitted when vault is empty (only meta files after init)", async () => {
    const { adapter } = await makeTempVault();
    const service = new VaultAutoInitService({ fsAdapter: adapter, mode: "manual" });
    const result = await service.initialize();
    expect(result.warnings).toEqual([]);
  });
});
