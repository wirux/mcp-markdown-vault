import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import type { IEmbeddingProvider } from "../domain/interfaces/embedding-provider.js";
import { VaultStatsComposer } from "./vault-stats.js";
import { VaultOverviewResourceComposer } from "./vault-resource-overview.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempVault() {
  const tmpPath = await mkdtemp(join(tmpdir(), "vault-resource-overview-test-"));
  const vaultPath = await realpath(tmpPath);
  tmpDirs.push(vaultPath);
  const adapter = await LocalFileSystemAdapter.create(vaultPath);
  return { adapter };
}

function fakeEmbedder(): IEmbeddingProvider {
  return {
    modelName: "test-model",
    embed: async () => [0, 0, 0],
    embedBatch: async (texts) => texts.map(() => [0, 0, 0]),
    dimensions: 3,
  };
}

function makeComposer(adapter: LocalFileSystemAdapter) {
  const statsComposer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
  return new VaultOverviewResourceComposer({ fsAdapter: adapter, statsComposer });
}

describe("VaultOverviewResourceComposer", () => {
  it("starts with # Vault Overview heading", async () => {
    const { adapter } = await makeTempVault();
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).toMatch(/^# Vault Overview/);
  });

  it("includes Quick Stats section", async () => {
    const { adapter } = await makeTempVault();
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).toContain("## Quick Stats");
    expect(result).toContain("**Files**:");
    expect(result).toContain("**Index status**:");
  });

  it("includes contract.md content when present", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/contract.md", "# Vault Navigation Contract\n\n## Scope\n\nMy scope");
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).toContain("Vault Navigation Contract");
    expect(result).toContain("My scope");
  });

  it("includes overview.md body when present and non-empty", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/overview.md", "---\nschema_version: 1\n---\n\n# Vault Overview\n\nActual content here.");
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).toContain("Actual content here.");
  });

  it("omits overview section when overview.md missing", async () => {
    const { adapter } = await makeTempVault();
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result.split("\n\n").length).toBeLessThanOrEqual(3);
  });

  it("omits overview section when overview.md body is only frontmatter and comments", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote(
      "meta/overview.md",
      "---\nschema_version: 1\nmanaged_by: user\n---\n\n<!-- Leave empty if you don't want to maintain it. -->",
    );
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).not.toContain("Leave empty");
  });

  it("composes header + stats + overview body when overview has content", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("meta/overview.md", "---\nschema_version: 1\n---\n\n# Overview\n\nSome content.");
    const composer = makeComposer(adapter);
    const result = await composer.compose();
    expect(result).toContain("# Vault Overview");
    expect(result).toContain("## Quick Stats");
    expect(result).toContain("Some content.");
  });
});
