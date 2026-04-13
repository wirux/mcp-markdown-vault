/**
 * Port interface for generating text diffs.
 *
 * Implementations produce a unified diff string that can be
 * displayed to users or AI clients for review before committing changes.
 */
export interface IDiffService {
  /**
   * Generate a unified diff between two strings.
   * @param oldText The original content.
   * @param newText The modified content.
   * @param filePath Optional file path for the diff header.
   * @returns A unified diff string with +/- lines.
   */
  generateDiff(oldText: string, newText: string, filePath?: string): string;
}
