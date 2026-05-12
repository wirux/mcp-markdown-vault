import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { NoteNotFoundError } from "../domain/errors/index.js";
import type { VaultStatsComposer } from "./vault-stats.js";
import { sanitizeForMarkdown } from "./markdown-utils.js";

function stripFrontmatterAndComments(content: string): string {
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      body = body.slice(end + 4);
    }
  }
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  return body.trim();
}

function formatStats(stats: Awaited<ReturnType<VaultStatsComposer["computeStats"]>>): string {
  const lines: string[] = [
    `## Quick Stats`,
    ``,
    `- **Files**: ${stats.fileCount}`,
    `- **Index status**: ${stats.indexStatus}`,
    `- **Embedding provider**: ${stats.embeddingProvider}`,
  ];

  if (stats.topDirectories.length > 0) {
    lines.push(`- **Top directories**:`);
    for (const dir of stats.topDirectories) {
      lines.push(`  - \`${dir.name}/\` (${dir.fileCount} files)`);
    }
  }

  return lines.join("\n");
}

export class VaultOverviewResourceComposer {
  private readonly fsAdapter: IFileSystemAdapter;
  private readonly statsComposer: VaultStatsComposer;
  private readonly vaultScope: string;

  constructor(deps: {
    fsAdapter: IFileSystemAdapter;
    statsComposer: VaultStatsComposer;
    vaultScope: string;
  }) {
    this.fsAdapter = deps.fsAdapter;
    this.statsComposer = deps.statsComposer;
    this.vaultScope = deps.vaultScope;
  }

  async compose(): Promise<string> {
    const safeScope = sanitizeForMarkdown(this.vaultScope);
    const sections: string[] = [`# Vault: ${safeScope}`];

    const stats = await this.statsComposer.computeStats();
    sections.push(formatStats(stats));

    const contractContent = await this.readFileSafe("meta/contract.md");
    if (contractContent !== null) {
      sections.push(contractContent);
    }

    const overviewContent = await this.readFileSafe("meta/overview.md");
    if (overviewContent !== null) {
      const body = stripFrontmatterAndComments(overviewContent);
      if (body) {
        sections.push(body);
      }
    }

    return sections.join("\n\n");
  }

  private async readFileSafe(path: string): Promise<string | null> {
    try {
      return await this.fsAdapter.readNote(path);
    } catch (err) {
      if (err instanceof NoteNotFoundError) return null;
      throw err;
    }
  }
}
