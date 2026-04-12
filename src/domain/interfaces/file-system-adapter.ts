/**
 * Port interface for file-system operations on an Obsidian vault.
 *
 * All paths are vault-relative (e.g. "daily/2024-01-01.md").
 * Implementations MUST reject paths that escape the vault root.
 */
export interface IFileSystemAdapter {
  /**
   * List all `.md` note paths under the given directory (recursive).
   * Returns vault-relative paths sorted alphabetically.
   * An empty `directory` means the vault root.
   */
  listNotes(directory?: string): Promise<string[]>;

  /**
   * Read the full UTF-8 content of a note.
   * @throws NoteNotFoundError if the file does not exist.
   */
  readNote(notePath: string): Promise<string>;

  /**
   * Write content to a note atomically (write-to-temp then rename).
   * Creates parent directories as needed.
   * @param overwrite When false, throws NoteAlreadyExistsError if file exists.
   */
  writeNote(
    notePath: string,
    content: string,
    overwrite?: boolean,
  ): Promise<void>;

  /**
   * Delete a note from the vault.
   * @throws NoteNotFoundError if the file does not exist.
   */
  deleteNote(notePath: string): Promise<void>;

  /**
   * Check whether a note exists.
   */
  exists(notePath: string): Promise<boolean>;

  /**
   * Return file metadata (size in bytes, last modified timestamp).
   * @throws NoteNotFoundError if the file does not exist.
   */
  stat(notePath: string): Promise<NoteStat>;
}

export interface NoteStat {
  /** Size in bytes */
  sizeBytes: number;
  /** Last modification time as ISO-8601 string */
  modifiedAt: string;
}
