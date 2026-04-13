import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { ITemplateEngine } from "../domain/interfaces/template-engine.js";
import { NoteAlreadyExistsError } from "../domain/errors/index.js";

/** Request DTO for the CreateFromTemplate use case. */
export interface CreateFromTemplateRequest {
  templatePath: string;
  destinationPath: string;
  variables?: Record<string, string> | undefined;
}

/** Response DTO for the CreateFromTemplate use case. */
export interface CreateFromTemplateResponse {
  message: string;
}

/** Contract for the CreateFromTemplate use case. */
export interface ICreateFromTemplateUseCase {
  execute(request: CreateFromTemplateRequest): Promise<CreateFromTemplateResponse>;
}

/**
 * Reads a template file, renders variable placeholders via an
 * {@link ITemplateEngine}, and saves the result to a new destination path.
 *
 * Safety: refuses to overwrite an existing destination file.
 */
export class CreateFromTemplateUseCase implements ICreateFromTemplateUseCase {
  constructor(
    private readonly fsAdapter: IFileSystemAdapter,
    private readonly templateEngine: ITemplateEngine,
  ) {}

  async execute(request: CreateFromTemplateRequest): Promise<CreateFromTemplateResponse> {
    const exists = await this.fsAdapter.exists(request.destinationPath);
    if (exists) {
      throw new NoteAlreadyExistsError(request.destinationPath);
    }

    const templateContent = await this.fsAdapter.readNote(request.templatePath);
    const rendered = this.templateEngine.render(templateContent, request.variables ?? {});
    await this.fsAdapter.writeNote(request.destinationPath, rendered);

    return { message: `Note created from template: ${request.destinationPath}` };
  }
}
