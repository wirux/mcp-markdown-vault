import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import { InvalidFrontmatterPayloadError } from "../domain/errors/index.js";

/** Request DTO for the GetFrontmatter use case. */
export interface GetFrontmatterRequest {
  path: string;
}

/** Response DTO for the GetFrontmatter use case. */
export interface GetFrontmatterResponse {
  frontmatter: Record<string, unknown>;
}

/** Request DTO for the SetFrontmatter use case. */
export interface SetFrontmatterRequest {
  path: string;
  /** JSON-stringified object representing the fields to merge. */
  content: string;
}

/** Response DTO for the SetFrontmatter use case. */
export interface SetFrontmatterResponse {
  message: string;
}

/** Contract for the GetFrontmatter use case. */
export interface IGetFrontmatterUseCase {
  execute(request: GetFrontmatterRequest): Promise<GetFrontmatterResponse>;
}

/** Contract for the SetFrontmatter use case. */
export interface ISetFrontmatterUseCase {
  execute(request: SetFrontmatterRequest): Promise<SetFrontmatterResponse>;
}

/**
 * Reads the YAML frontmatter of a markdown note as a plain object.
 */
export class GetFrontmatterUseCase implements IGetFrontmatterUseCase {
  constructor(private readonly repo: IMarkdownRepository) {}

  async execute(request: GetFrontmatterRequest): Promise<GetFrontmatterResponse> {
    const frontmatter = await this.repo.readFrontmatter(request.path);
    return { frontmatter };
  }
}

/**
 * Merges fields into the YAML frontmatter of a markdown note.
 *
 * The incoming `content` string is parsed as JSON. On invalid JSON,
 * an {@link InvalidFrontmatterPayloadError} is thrown before any I/O.
 */
export class SetFrontmatterUseCase implements ISetFrontmatterUseCase {
  constructor(private readonly repo: IMarkdownRepository) {}

  async execute(request: SetFrontmatterRequest): Promise<SetFrontmatterResponse> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(request.content) as Record<string, unknown>;
    } catch {
      throw new InvalidFrontmatterPayloadError(
        "content is not valid JSON",
      );
    }

    await this.repo.updateFrontmatter(request.path, parsed);
    return { message: `Frontmatter updated: ${request.path}` };
  }
}
