import type { Root } from "mdast";

/**
 * Port interface for reading a markdown file as a parsed AST,
 * and for reading/updating its YAML frontmatter.
 *
 * Combines file-system access with markdown parsing behind a single
 * contract so that use cases can work with ASTs without knowing how
 * files are read or parsed.
 */
export interface IMarkdownRepository {
  /**
   * Read and parse a markdown note, returning its mdast Root tree.
   * @param filePath Vault-relative path (e.g. "daily/2024-01-01.md").
   * @throws NoteNotFoundError if the file does not exist.
   */
  getAstByPath(filePath: string): Promise<Root>;

  /**
   * Read the YAML frontmatter of a note as a plain object.
   * Returns `{}` if the note has no frontmatter.
   * @throws NoteNotFoundError if the file does not exist.
   */
  readFrontmatter(filePath: string): Promise<Record<string, unknown>>;

  /**
   * Merge fields into the note's YAML frontmatter and write the file back.
   * Existing fields not present in `dataToMerge` are preserved.
   * The markdown body is never modified.
   * If the note has no frontmatter, one is created.
   * @throws NoteNotFoundError if the file does not exist.
   */
  updateFrontmatter(
    filePath: string,
    dataToMerge: Record<string, unknown>,
  ): Promise<void>;
}
