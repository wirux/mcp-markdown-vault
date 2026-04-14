import path from "node:path";
import type { Root } from "mdast";
import type { IBacklinkIndex, BacklinkEntry } from "../domain/interfaces/backlink-index.js";
import type { MarkdownPipeline } from "./markdown-pipeline.js";
import { WikilinkResolver } from "./wikilink-resolver.js";

// Klucz mapy to znormalizowana ścieżka: lowercase, bez rozszerzenia .md
function normalizeKey(filePath: string): string {
  const withoutExt = filePath.endsWith(".md")
    ? filePath.slice(0, -3)
    : filePath;
  return withoutExt.toLowerCase();
}

// Numer linii na podstawie pozycji (offset) w tekście
function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// Fragment kontekstowy ±30 znaków wokół pozycji
function extractContext(
  content: string,
  offset: number,
  matchLength: number,
): string {
  const start = Math.max(0, offset - 30);
  const end = Math.min(content.length, offset + matchLength + 30);
  return content.slice(start, end).replace(/\n/g, " ");
}

// Sprawdza czy URL jest zewnętrzny (http, mailto, itp.)
function isExternalUrl(url: string): boolean {
  return /^[a-z]+:\/\//i.test(url) || url.startsWith("mailto:") || url.startsWith("#");
}

// Rozwiązuje relatywny link markdown na ścieżkę vault-relative
function resolveRelativeLink(sourcePath: string, url: string): string {
  const cleanUrl = url.split("#")[0]!.split("?")[0]!;
  if (!cleanUrl) return "";
  const dir = path.posix.dirname(sourcePath);
  return path.posix.normalize(path.posix.join(dir, cleanUrl));
}

// Rekurencyjne szukanie węzłów danego typu w drzewie AST
interface LinkNode {
  type: "link";
  url: string;
  position?: { start: { line: number; offset: number } } | undefined;
}

function findLinkNodes(node: unknown): LinkNode[] {
  const results: LinkNode[] = [];
  const walk = (n: unknown): void => {
    if (typeof n !== "object" || n === null) return;
    const obj = n as Record<string, unknown>;
    if (obj["type"] === "link") results.push(n as unknown as LinkNode);
    if (Array.isArray(obj["children"])) {
      for (const child of obj["children"]) walk(child);
    }
  };
  walk(node);
  return results;
}

// Wyodrębnia wikilinki z pozycjami w tekście
interface WikilinkMatch {
  target: string;
  index: number;
  fullLength: number;
}

function extractWikilinksWithPositions(content: string): WikilinkMatch[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({
      target: match[1]!,
      index: match.index,
      fullLength: match[0].length,
    });
  }
  return results;
}

/**
 * Usługa indeksująca backlinki w vault.
 * Przechowuje mapę: znormalizowana ścieżka docelowa → lista wpisów BacklinkEntry.
 */
export class BacklinkIndexService implements IBacklinkIndex {
  private readonly index = new Map<string, BacklinkEntry[]>();
  private resolver: WikilinkResolver | null = null;

  constructor(private readonly pipeline: MarkdownPipeline) {}

  /** Liczba unikalnych celów śledzonych w indeksie. */
  get indexSize(): number {
    return this.index.size;
  }

  getBacklinks(targetPath: string): BacklinkEntry[] {
    const key = normalizeKey(targetPath);
    return this.index.get(key) ?? [];
  }

  rebuildIndex(entries: Array<{ path: string; content: string }>): void {
    this.index.clear();
    this.resolver = new WikilinkResolver(entries.map((e) => e.path));
    for (const entry of entries) {
      this.processFile(entry.path, entry.content);
    }
  }

  updateFile(filePath: string, content: string): void {
    // Usuń stare wpisy i dodaj nowe
    this.removeFile(filePath);
    this.processFile(filePath, content);
  }

  removeFile(filePath: string): void {
    // Usuń wszystkie wpisy gdzie sourcePath === filePath
    for (const [key, entries] of this.index) {
      const filtered = entries.filter((e) => e.sourcePath !== filePath);
      if (filtered.length === 0) {
        this.index.delete(key);
      } else {
        this.index.set(key, filtered);
      }
    }
  }

  private processFile(sourcePath: string, content: string): void {
    const sourceKey = normalizeKey(sourcePath);

    // Wyodrębnij wikilinki
    const wikilinks = extractWikilinksWithPositions(content);
    for (const wl of wikilinks) {
      const resolved = this.resolver?.resolve(wl.target);
      const targetPath = resolved ?? `${wl.target}.md`;
      const targetKey = normalizeKey(targetPath);

      // Pomiń self-linki
      if (targetKey === sourceKey) continue;

      this.addEntry(targetKey, {
        sourcePath,
        lineNumber: lineAtOffset(content, wl.index),
        context: extractContext(content, wl.index, wl.fullLength),
        linkType: "wikilink",
      });
    }

    // Wyodrębnij linki markdown z AST
    const tree: Root = this.pipeline.parse(content);
    const linkNodes = findLinkNodes(tree);
    for (const node of linkNodes) {
      if (isExternalUrl(node.url)) continue;

      const resolvedPath = resolveRelativeLink(sourcePath, node.url);
      if (!resolvedPath) continue;

      const targetKey = normalizeKey(resolvedPath);
      if (targetKey === sourceKey) continue;

      const offset = node.position?.start.offset ?? 0;
      this.addEntry(targetKey, {
        sourcePath,
        lineNumber: node.position?.start.line ?? 1,
        context: extractContext(content, offset, node.url.length + 4),
        linkType: "markdown_link",
      });
    }
  }

  private addEntry(targetKey: string, entry: BacklinkEntry): void {
    const existing = this.index.get(targetKey);
    if (existing) {
      existing.push(entry);
    } else {
      this.index.set(targetKey, [entry]);
    }
  }
}
