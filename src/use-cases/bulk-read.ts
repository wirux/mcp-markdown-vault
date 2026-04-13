import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IReadByHeadingUseCase } from "./read-by-heading.js";

/** A single item in a bulk read request. */
export interface ReadItem {
  path: string;
  heading?: string | undefined;
  headingDepth?: number | undefined;
}

/** Request DTO for the BulkRead use case. */
export interface BulkReadRequest {
  items: ReadItem[];
}

/** A single result in a bulk read response. */
export interface BulkReadResultItem {
  path: string;
  heading?: string | undefined;
  content?: string | undefined;
  found: boolean;
  error?: string | undefined;
}

/** Response DTO for the BulkRead use case. */
export interface BulkReadResponse {
  results: BulkReadResultItem[];
}

/** Contract for the BulkRead use case. */
export interface IBulkReadUseCase {
  execute(request: BulkReadRequest): Promise<BulkReadResponse>;
}

/**
 * Reads multiple files (or heading-scoped sections) in a single call.
 *
 * Delegates to {@link IFileSystemAdapter.readNote} for full reads and
 * {@link IReadByHeadingUseCase} for heading-scoped reads. Individual
 * failures are captured per-item rather than aborting the entire batch.
 */
export class BulkReadUseCase implements IBulkReadUseCase {
  constructor(
    private readonly fsAdapter: IFileSystemAdapter,
    private readonly headingReader: IReadByHeadingUseCase,
  ) {}

  async execute(request: BulkReadRequest): Promise<BulkReadResponse> {
    const results = await Promise.all(
      request.items.map((item) => this.readItem(item)),
    );
    return { results };
  }

  private async readItem(item: ReadItem): Promise<BulkReadResultItem> {
    try {
      if (item.heading) {
        const result = await this.headingReader.execute({
          path: item.path,
          heading: item.heading,
          headingDepth: item.headingDepth,
        });
        return {
          path: item.path,
          heading: item.heading,
          content: result.found ? result.content : undefined,
          found: result.found,
          error: result.found ? undefined : `Heading "${item.heading}" not found in ${item.path}`,
        };
      }

      const content = await this.fsAdapter.readNote(item.path);
      return { path: item.path, content, found: true };
    } catch (err) {
      return {
        path: item.path,
        heading: item.heading,
        found: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
