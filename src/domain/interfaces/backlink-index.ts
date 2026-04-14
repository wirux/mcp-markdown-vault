/** Wpis backlinku — informacja o jednym linku prowadzącym do pliku docelowego. */
export interface BacklinkEntry {
  sourcePath: string;
  lineNumber: number;
  context: string;
  linkType: "wikilink" | "markdown_link";
}

/** Port dla indeksu backlinków. */
export interface IBacklinkIndex {
  /** Zwraca backlinki prowadzące do podanej ścieżki docelowej. */
  getBacklinks(targetPath: string): BacklinkEntry[];

  /** Przebudowuje cały indeks z podanych plików. */
  rebuildIndex(entries: Array<{ path: string; content: string }>): void;

  /** Aktualizuje indeks dla pojedynczego pliku (usuwa stare wpisy i dodaje nowe). */
  updateFile(path: string, content: string): void;

  /** Usuwa wszystkie wpisy backlinków gdzie plik jest źródłem linku. */
  removeFile(path: string): void;
}
