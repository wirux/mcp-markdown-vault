import { FreeformEditError } from "../domain/errors/index.js";

/**
 * Freeform (non-AST) editing operations.
 *
 * Provides line-range replacement and string find/replace as a fallback
 * for content that doesn't have heading or block ID anchors.
 */
export class FreeformEditor {
  /**
   * Replace a range of lines (1-based, inclusive) with new content.
   */
  static lineReplace(
    source: string,
    startLine: number,
    endLine: number,
    content: string,
  ): string {
    const lines = source.split("\n");

    if (startLine < 1) {
      throw new FreeformEditError(
        `startLine must be >= 1, got ${startLine}`,
      );
    }
    if (endLine > lines.length) {
      throw new FreeformEditError(
        `endLine ${endLine} exceeds file length (${lines.length} lines)`,
      );
    }
    if (startLine > endLine) {
      throw new FreeformEditError(
        `startLine (${startLine}) must be <= endLine (${endLine})`,
      );
    }

    const newLines = content.split("\n");
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
    return lines.join("\n");
  }

  /**
   * Find and replace a literal string. Uses exact string matching
   * (no regex) to avoid brittle patterns.
   */
  static stringReplace(
    source: string,
    search: string,
    replace: string,
    replaceAll?: boolean,
  ): string {
    if (!source.includes(search)) {
      throw new FreeformEditError(`Search string not found: "${search}"`);
    }

    if (replaceAll) {
      return source.split(search).join(replace);
    }

    // Replace first occurrence only
    const idx = source.indexOf(search);
    return source.slice(0, idx) + replace + source.slice(idx + search.length);
  }
}
