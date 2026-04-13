import type { Root } from "mdast";

/**
 * Port interface for reading a markdown file as a parsed AST.
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
}
