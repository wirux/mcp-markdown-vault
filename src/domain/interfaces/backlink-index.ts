/** Backlink entry — information about a single link pointing to a target file. */
export interface BacklinkEntry {
  sourcePath: string;
  lineNumber: number;
  context: string;
  linkType: "wikilink" | "markdown_link";
}

/** Port for the backlink index. */
export interface IBacklinkIndex {
  /** Returns backlinks pointing to the given target path. */
  getBacklinks(targetPath: string): BacklinkEntry[];

  /** Rebuilds the entire index from the given files. */
  rebuildIndex(entries: Array<{ path: string; content: string }>): void;

  /** Updates the index for a single file (removes old entries and adds new ones). */
  updateFile(path: string, content: string): void;

  /** Removes all backlink entries where the file is a link source. */
  removeFile(path: string): void;
}
