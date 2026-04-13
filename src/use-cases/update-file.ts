import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";

/** Request DTO for the UpdateFile use case. */
export interface UpdateFileRequest {
  path: string;
  content: string;
}

/** Response DTO for the UpdateFile use case. */
export interface UpdateFileResponse {
  message: string;
}

/** Contract for the UpdateFile use case. */
export interface IUpdateFileUseCase {
  execute(request: UpdateFileRequest): Promise<UpdateFileResponse>;
}

/**
 * Completely replaces a note's content (upsert semantics).
 *
 * Delegates to {@link IFileSystemAdapter.writeNote} with `overwrite=true`,
 * creating the file if it doesn't exist or replacing it if it does.
 */
export class UpdateFileUseCase implements IUpdateFileUseCase {
  constructor(private readonly fsAdapter: IFileSystemAdapter) {}

  async execute(request: UpdateFileRequest): Promise<UpdateFileResponse> {
    await this.fsAdapter.writeNote(request.path, request.content, true);
    return { message: `Note updated: ${request.path}` };
  }
}
