import yaml from "js-yaml";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { ISamplingProvider } from "../domain/interfaces/sampling-provider.js";
import { generateVaultScope } from "./vault-scope.js";
import { computeEvidenceHash, extractStoredHash } from "./evidence-hash.js";
import type { VaultEvidence } from "./evidence-hash.js";
import { buildSamplingPrompt, parseSamplingResponse, SAMPLING_TIMEOUT_MS } from "./sampling-prompt.js";
import { MAX_CONTEXT_CHARS } from "./sampling-prompt.js";

interface DirectorySummary {
  name: string;
  fileCount: number;
}

interface TagSummary {
  name: string;
  count: number;
}

const DEFAULT_THRESHOLD = 5;
const MAX_DIRECTORIES = 10;
const MAX_TAGS = 20;
const MAX_TITLES = 10;
const MIN_FILES_FOR_SAMPLING = 3;

export class OverviewManager {
  private readonly fsAdapter: IFileSystemAdapter;
  private readonly threshold: number;
  private readonly getSamplingProvider: (() => ISamplingProvider | null) | undefined;
  private isGenerating = false;

  constructor(deps: {
    fsAdapter: IFileSystemAdapter;
    threshold?: number;
    getSamplingProvider?: () => ISamplingProvider | null;
  }) {
    this.fsAdapter = deps.fsAdapter;
    this.threshold = deps.threshold ?? DEFAULT_THRESHOLD;
    this.getSamplingProvider = deps.getSamplingProvider;
  }

  async generate(): Promise<string> {
    const timestamp = new Date().toISOString();
    const notePaths = await this.fsAdapter.listNotes();
    const nonMetaNotePaths = notePaths.filter((p) => !p.startsWith("meta/"));

    const topDirectories = this.collectTopDirectories(nonMetaNotePaths);
    const tags = await this.collectTags(nonMetaNotePaths);
    const recentTitles = await this.collectRecentTitles(nonMetaNotePaths);
    const directoryCount = new Set(
      nonMetaNotePaths
        .map((p) => getTopLevelDirectory(p))
        .filter((d): d is string => d !== undefined),
    ).size;

    const evidence: VaultEvidence = {
      totalFiles: nonMetaNotePaths.length,
      directories: topDirectories.map((d) => d.name),
      tags: tags.map((t) => t.name),
      titles: recentTitles,
    };

    const currentHash = computeEvidenceHash(evidence);

    let storedHash: string | undefined;
    try {
      const existing = await this.fsAdapter.readNote("meta/overview.md");
      storedHash = extractStoredHash(existing);
    } catch {
      storedHash = undefined;
    }

    if (storedHash === currentHash) {
      const existing = await this.fsAdapter.readNote("meta/overview.md");
      return existing;
    }

    let vaultScope: string;
    let vaultContext: string;
    let generationSource: "sampling" | "deterministic" = "deterministic";

    const deterministicScope = generateVaultScope({
      totalFiles: nonMetaNotePaths.length,
      directories: topDirectories,
      tags,
    });
    const deterministicContext = buildDeterministicContext(evidence);

    if (
      nonMetaNotePaths.length >= MIN_FILES_FOR_SAMPLING &&
      this.getSamplingProvider !== undefined
    ) {
      const provider = this.getSamplingProvider();
      if (provider !== null && provider.isAvailable()) {
        try {
          const request = buildSamplingPrompt(evidence);
          const responsePromise = provider.createMessage(request);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("sampling timeout")), SAMPLING_TIMEOUT_MS),
          );
          const response = await Promise.race([responsePromise, timeoutPromise]);
          const parsed = parseSamplingResponse(response);
          if (parsed.ok) {
            vaultScope = parsed.vault_scope;
            vaultContext = parsed.vault_context;
            generationSource = "sampling";
          } else {
            vaultScope = deterministicScope;
            vaultContext = deterministicContext;
          }
        } catch {
          vaultScope = deterministicScope;
          vaultContext = deterministicContext;
        }
      } else {
        vaultScope = deterministicScope;
        vaultContext = deterministicContext;
      }
    } else {
      vaultScope = deterministicScope;
      vaultContext = deterministicContext;
    }

    const frontmatter = yaml.dump({
      schema_version: 2,
      generated_by: "mcp-markdown-vault",
      generated_at: timestamp,
      managed_by: "auto",
      generation_source: generationSource,
      evidence_hash: currentHash,
      vault_scope: vaultScope,
      vault_context: vaultContext,
    });

    return [
      "---",
      frontmatter.trimEnd(),
      "---",
      "",
      "# Vault Overview",
      "",
      "## About This Vault",
      "",
      vaultContext,
      "",
      "## Statistics",
      "",
      `- **Total files**: ${nonMetaNotePaths.length}`,
      `- **Directories**: ${directoryCount}`,
      "",
      "## Top Directories",
      "",
      ...formatDirectorySection(topDirectories),
      "",
      "## Common Tags",
      "",
      ...formatTagSection(tags),
      "",
      "## Recent Note Titles",
      "",
      ...formatTitleSection(recentTitles),
      "",
    ].join("\n");
  }

  async writeOverview(): Promise<void> {
    if (this.isGenerating) return;
    this.isGenerating = true;
    try {
      const content = await this.generate();
      await this.fsAdapter.writeNote("meta/overview.md", content, true);
    } finally {
      this.isGenerating = false;
    }
  }

  shouldRefresh(changeCount: number): boolean {
    return changeCount >= this.threshold;
  }

  private collectTopDirectories(notePaths: string[]): DirectorySummary[] {
    const directoryCounts = new Map<string, number>();

    for (const notePath of notePaths) {
      const directory = getTopLevelDirectory(notePath);
      if (directory === undefined) {
        continue;
      }

      directoryCounts.set(directory, (directoryCounts.get(directory) ?? 0) + 1);
    }

    return [...directoryCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_DIRECTORIES)
      .map(([name, fileCount]) => ({ name, fileCount }));
  }

  private async collectTags(notePaths: string[]): Promise<TagSummary[]> {
    const tagCounts = new Map<string, number>();

    for (const notePath of notePaths) {
      const content = await this.readNoteSafely(notePath);
      if (content === undefined) {
        continue;
      }

      for (const tag of extractTags(content)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return [...tagCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_TAGS)
      .map(([name, count]) => ({ name, count }));
  }

  private async collectRecentTitles(notePaths: string[]): Promise<string[]> {
    const sortedPaths = [...notePaths].sort((left, right) => left.localeCompare(right)).slice(0, MAX_TITLES);
    const titles: string[] = [];

    for (const notePath of sortedPaths) {
      const content = await this.readNoteSafely(notePath);
      if (content === undefined) {
        continue;
      }

      const title = extractFirstH1(content);
      if (title !== undefined) {
        titles.push(title);
      }
    }

    return titles;
  }

  private async readNoteSafely(notePath: string): Promise<string | undefined> {
    try {
      return await this.fsAdapter.readNote(notePath);
    } catch {
      return undefined;
    }
  }
}

function buildDeterministicContext(evidence: VaultEvidence): string {
  const topDirs = evidence.directories.slice(0, 3).join(", ");
  const topTags = evidence.tags.slice(0, 5).join(", ");
  const parts: string[] = [`Vault with ${evidence.totalFiles} files`];
  if (topDirs.length > 0) parts.push(`across ${topDirs}`);
  const base = parts.join(" ") + ".";
  const tagPart = topTags.length > 0 ? ` Main topics: ${topTags}.` : "";
  const full = base + tagPart;
  return full.length <= MAX_CONTEXT_CHARS ? full : full.slice(0, MAX_CONTEXT_CHARS - 1) + "\u2026";
}

function getTopLevelDirectory(notePath: string): string | undefined {
  const slashIndex = notePath.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }

  return notePath.slice(0, slashIndex);
}

function extractTags(content: string): string[] {
  const frontmatter = extractFrontmatter(content);
  if (frontmatter === undefined) {
    return [];
  }

  const parsed = yaml.load(frontmatter);
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const rawTags = (parsed as Record<string, unknown>).tags;
  return normalizeTags(rawTags);
}

function normalizeTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  if (typeof rawTags === "string") {
    return rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  return [];
}

function extractFrontmatter(content: string): string | undefined {
  if (!content.startsWith("---\n")) {
    return undefined;
  }

  const closingIndex = content.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return undefined;
  }

  return content.slice(4, closingIndex);
}

function extractFirstH1(content: string): string | undefined {
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      return title.length > 0 ? title : undefined;
    }
  }

  return undefined;
}

function formatDirectorySection(directories: DirectorySummary[]): string[] {
  if (directories.length === 0) {
    return ["- None"];
  }

  return directories.map((directory) => `- \`${directory.name}/\` — ${directory.fileCount} files`);
}

function formatTagSection(tags: TagSummary[]): string[] {
  if (tags.length === 0) {
    return ["- None"];
  }

  return tags.map((tag) => `- \`${tag.name}\` (${tag.count})`);
}

function formatTitleSection(titles: string[]): string[] {
  if (titles.length === 0) {
    return ["- None"];
  }

  return titles.map((title) => `- ${title}`);
}
