import { createTwoFilesPatch } from "diff";
import type { IDiffService } from "../domain/interfaces/diff-service.js";

/**
 * Generates unified diffs using the `diff` npm package.
 */
export class UnifiedDiffService implements IDiffService {
  generateDiff(oldText: string, newText: string, filePath?: string): string {
    const name = filePath ?? "file";
    return createTwoFilesPatch(name, name, oldText, newText);
  }
}
