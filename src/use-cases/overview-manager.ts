import yaml from "js-yaml";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { MAX_SCOPE_CHARS } from "./vault-scope.js";

const MAX_DIRECTORIES = 10;
const MAX_TAGS = 20;
const MAX_TITLES = 10;

export interface OverviewStatus {
  status: "missing" | "present";
  managed_by: string | null;
  updated_at: string | null;
}

export interface VaultEvidence {
  fileCount: number;
  directories: string[];
  tags: string[];
  recentTitles: string[];
}

interface DirectorySummary {
  name: string;
  fileCount: number;
}

interface TagSummary {
  name: string;
  count: number;
}

export class OverviewManager {
  private readonly fsAdapter: IFileSystemAdapter;

  constructor(deps: { fsAdapter: IFileSystemAdapter }) {
    this.fsAdapter = deps.fsAdapter;
  }

  async getStatus(): Promise<OverviewStatus> {
    let content: string;
    try {
      content = await this.fsAdapter.readNote("meta/overview.md");
    } catch {
      return { status: "missing", managed_by: null, updated_at: null };
    }

    const frontmatter = parseFrontmatter(content);
    if (frontmatter === null) {
      return { status: "present", managed_by: null, updated_at: null };
    }

    const managed_by = typeof frontmatter["managed_by"] === "string" ? frontmatter["managed_by"] : null;
    const updated_at = typeof frontmatter["updated_at"] === "string" ? frontmatter["updated_at"] : null;

    return {
      status: "present",
      managed_by,
      updated_at,
    };
  }

  async readOverview(): Promise<string | null> {
    try {
      return await this.fsAdapter.readNote("meta/overview.md");
    } catch {
      return null;
    }
  }

  async saveOverview(text: string, scope: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const trimmedScope = scope.replace(/\s+/g, " ").trim().slice(0, MAX_SCOPE_CHARS);
    const frontmatter = yaml.dump({
      schema_version: 3,
      vault_scope: trimmedScope,
      updated_at: timestamp,
      managed_by: "host",
    });

    const content = [
      "---",
      frontmatter.trimEnd(),
      "---",
      "",
      "# Vault Overview",
      "",
      text,
      "",
    ].join("\n");

    await this.fsAdapter.writeNote("meta/overview.md", content, true);
  }

  async gatherEvidence(): Promise<VaultEvidence> {
    const notePaths = await this.fsAdapter.listNotes();
    const nonMetaNotePaths = notePaths.filter((p) => !p.startsWith("meta/"));

    const topDirectories = this.collectTopDirectories(nonMetaNotePaths);
    const tags = await this.collectTags(nonMetaNotePaths);
    const recentTitles = await this.collectRecentTitles(nonMetaNotePaths);

    return {
      fileCount: nonMetaNotePaths.length,
      directories: topDirectories.map((d) => d.name),
      tags: tags.map((t) => t.name),
      recentTitles,
    };
  }

  collectTopDirectories(notePaths: string[]): DirectorySummary[] {
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

  async collectTags(notePaths: string[]): Promise<TagSummary[]> {
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

  async collectRecentTitles(notePaths: string[]): Promise<string[]> {
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

function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }

  const closingIndex = content.indexOf("\n---\n", 4);
  const closingIndexAlt = content.indexOf("\n---\r\n", 4);
  const endIdx =
    closingIndex !== -1
      ? closingIndex
      : closingIndexAlt !== -1
        ? closingIndexAlt
        : -1;

  if (endIdx === -1) {
    return null;
  }

  const frontmatterRaw = content.slice(4, endIdx);

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatterRaw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function getTopLevelDirectory(notePath: string): string | undefined {
  const slashIndex = notePath.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }

  return notePath.slice(0, slashIndex);
}

function extractTags(content: string): string[] {
  const frontmatter = extractFrontmatterRaw(content);
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

function extractFrontmatterRaw(content: string): string | undefined {
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
