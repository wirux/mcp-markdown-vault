import type { IDiffService } from "../domain/interfaces/diff-service.js";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";

/** Request DTO for a dry-run-aware edit. */
export interface DryRunEditRequest {
  path: string;
  oldContent: string;
  newContent: string;
  dryRun: boolean;
  operationLabel: string;
}

/** Response DTO for a dry-run-aware edit. */
export interface DryRunEditResponse {
  message: string;
  diff?: string | undefined;
}

/** Contract for the DryRunEditor use case. */
export interface IDryRunEditor {
  execute(request: DryRunEditRequest): Promise<DryRunEditResponse>;
}

/**
 * Decides whether to commit an edit or return a diff preview.
 *
 * When `dryRun` is true, generates a unified diff via {@link IDiffService}
 * and returns it without writing. When false, writes the new content to disk.
 */
export class DryRunEditor implements IDryRunEditor {
  constructor(
    private readonly fsAdapter: IFileSystemAdapter,
    private readonly diffService: IDiffService,
  ) {}

  async execute(request: DryRunEditRequest): Promise<DryRunEditResponse> {
    if (request.dryRun) {
      const diff = this.diffService.generateDiff(
        request.oldContent,
        request.newContent,
        request.path,
      );
      return {
        message: `dry-run: ${request.path} (${request.operationLabel})`,
        diff,
      };
    }

    await this.fsAdapter.writeNote(request.path, request.newContent, true);
    return {
      message: `Note patched: ${request.path} (${request.operationLabel})`,
    };
  }
}
