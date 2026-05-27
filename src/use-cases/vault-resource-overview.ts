import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { NoteNotFoundError } from "../domain/errors/index.js";
import type { VaultStatsComposer } from "./vault-stats.js";

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

function formatAgentOrientation(): string {
  return [
    `## Agent Orientation`,
    ``,
    `Use this resource as the starting map for the vault. It combines live server stats, the human or host-authored overview, and the editable vault contract.`,
    ``,
    `### Search Strategy`,
    ``,
    `- Conceptual or fuzzy questions → \`view.semantic_search\``,
    `- Exact phrases, tags, or regex-like lookups → \`view.global_search\``,
    `- Relevant fragments inside one known file → \`view.search\``,
    `- A full note or one heading-scoped section → \`view.read\``,
    `- Several known files or sections at once → \`view.bulk_read\``,
    `- A note's incoming links → \`view.backlinks\``,
    `- YAML metadata inspection → \`view.frontmatter_get\``,
    ``,
    `### Editing Safety`,
    ``,
    `- Prefer \`edit\` for surgical changes by heading or block ID; use \`vault.update\` only when replacing a whole note intentionally.`,
    `- Set \`dryRun=true\` on \`edit\` to preview a unified diff before writing.`,
    `- Use \`edit.frontmatter_set\` for metadata changes instead of rewriting frontmatter by hand.`,
    ``,
    `### Overview Maintenance`,
    ``,
    `- To refresh this overview, call \`system.prepare_overview\`, write concise prose from the returned evidence, then call \`system.save_overview\`.`,
    `- The server gathers evidence and persists the file; the connected host agent writes the semantic prose.`,
    ``,
    `### Workflow State`,
    ``,
    `- The \`workflow\` tool is optional session state: search/explore first, edit next, review before done.`,
  ].join("\n");
}

export class VaultOverviewResourceComposer {
  private readonly fsAdapter: IFileSystemAdapter;
  private readonly statsComposer: VaultStatsComposer;

  constructor(deps: {
    fsAdapter: IFileSystemAdapter;
    statsComposer: VaultStatsComposer;
  }) {
    this.fsAdapter = deps.fsAdapter;
    this.statsComposer = deps.statsComposer;
  }

  async compose(): Promise<string> {
    const sections: string[] = [`# Vault Overview`];

    const stats = await this.statsComposer.computeStats();
    sections.push(formatStats(stats));
    sections.push(formatAgentOrientation());

    const overviewContent = await this.readFileSafe("meta/overview.md");
    if (overviewContent !== null) {
      const body = stripFrontmatterAndComments(overviewContent);
      if (body) {
        sections.push(body);
      }
    }

    const contractContent = await this.readFileSafe("meta/contract.md");
    if (contractContent !== null) {
      const body = stripFrontmatterAndComments(contractContent);
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
