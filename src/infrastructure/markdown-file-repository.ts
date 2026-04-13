import type { Root } from "mdast";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";

/**
 * Reads a markdown note from the file system and returns a parsed AST.
 *
 * Composes {@link IFileSystemAdapter} (I/O) with {@link MarkdownPipeline}
 * (parsing) behind the {@link IMarkdownRepository} port.
 */
export class MarkdownFileRepository implements IMarkdownRepository {
  constructor(
    private readonly fsAdapter: IFileSystemAdapter,
    private readonly pipeline: MarkdownPipeline,
  ) {}

  async getAstByPath(filePath: string): Promise<Root> {
    const content = await this.fsAdapter.readNote(filePath);
    return this.pipeline.parse(content);
  }
}
