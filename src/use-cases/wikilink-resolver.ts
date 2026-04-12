import path from "node:path";

/**
 * Resolves [[wikilinks]] (Obsidian/markdown style) to vault-relative file paths.
 *
 * Uses the "Shortest Path" algorithm: when multiple files share the same
 * filename, the one with the fewest path segments wins.
 * Ties are broken alphabetically for determinism.
 */
export class WikilinkResolver {
  /** Map from lowercase basename (without .md) → sorted candidates. */
  private readonly index: Map<string, string[]>;

  constructor(vaultFiles: string[]) {
    this.index = new Map();

    for (const filePath of vaultFiles) {
      const basename = path
        .basename(filePath, ".md")
        .toLowerCase();

      const existing = this.index.get(basename);
      if (existing) {
        existing.push(filePath);
      } else {
        this.index.set(basename, [filePath]);
      }
    }

    // Sort each bucket: fewer segments first, then alphabetical
    for (const candidates of this.index.values()) {
      candidates.sort((a, b) => {
        const depthA = a.split("/").length;
        const depthB = b.split("/").length;
        if (depthA !== depthB) return depthA - depthB;
        return a.localeCompare(b);
      });
    }
  }

  /**
   * Resolve a wikilink string to a vault-relative path.
   *
   * Handles:
   * - `[[note]]` — filename match
   * - `[[folder/note]]` — partial path match
   * - `[[note#heading]]` / `[[note#^block]]` — strips anchor
   * - `[[note.md]]` — strips extension
   * - `[[note|alias]]` — alias is handled by extractWikilinks
   *
   * Returns null if no match found.
   */
  resolve(link: string): string | null {
    // Strip anchor (#heading or #^block-id)
    const withoutAnchor = link.split("#")[0]!;

    // Strip .md extension if present
    const normalized = withoutAnchor.endsWith(".md")
      ? withoutAnchor.slice(0, -3)
      : withoutAnchor;

    // Try partial path match first (e.g., "mcp-server/architecture")
    if (normalized.includes("/")) {
      return this.resolvePartialPath(normalized);
    }

    // Simple filename match
    const candidates = this.index.get(normalized.toLowerCase());
    if (!candidates || candidates.length === 0) return null;
    return candidates[0]!;
  }

  private resolvePartialPath(partial: string): string | null {
    const suffix = `${partial.toLowerCase()}.md`;

    // Search all files for one whose path ends with the partial
    const matches: string[] = [];
    for (const candidates of this.index.values()) {
      for (const filePath of candidates) {
        if (filePath.toLowerCase().endsWith(suffix)) {
          matches.push(filePath);
        }
      }
    }

    if (matches.length === 0) return null;

    // Shortest path, then alphabetical
    matches.sort((a, b) => {
      const depthA = a.split("/").length;
      const depthB = b.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    return matches[0]!;
  }

  /**
   * Extract all [[wikilink]] targets from raw markdown text.
   * Handles [[link|alias]] by returning only the link part.
   */
  static extractWikilinks(markdown: string): string[] {
    const regex = /\[\[([^\]]+)\]\]/g;
    const results: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(markdown)) !== null) {
      const inner = match[1]!;
      // Strip alias: [[target|display text]] → target
      const target = inner.split("|")[0]!;
      results.push(target);
    }

    return results;
  }
}
