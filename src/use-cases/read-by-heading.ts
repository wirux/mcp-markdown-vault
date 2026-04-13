import type { Root } from "mdast";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import type { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstNavigator } from "./ast-navigation.js";

/** Request DTO for the ReadByHeading use case. */
export interface ReadHeadingRequest {
  path: string;
  heading: string;
  headingDepth?: number | undefined;
}

/** Response DTO for the ReadByHeading use case. */
export interface ReadHeadingResponse {
  content: string;
  found: boolean;
}

/** Contract for the ReadByHeading use case. */
export interface IReadByHeadingUseCase {
  execute(request: ReadHeadingRequest): Promise<ReadHeadingResponse>;
}

/**
 * Extracts the content under a specific heading from a markdown note.
 *
 * Uses the AST to locate the heading section and serializes only the
 * matching nodes back to a markdown string.
 */
export class ReadByHeadingUseCase implements IReadByHeadingUseCase {
  constructor(
    private readonly markdownRepo: IMarkdownRepository,
    private readonly pipeline: MarkdownPipeline,
  ) {}

  async execute(request: ReadHeadingRequest): Promise<ReadHeadingResponse> {
    const depth = request.headingDepth ?? 2;
    const tree = await this.markdownRepo.getAstByPath(request.path);

    const range = AstNavigator.getHeadingRange(tree, request.heading, depth);
    if (!range) {
      return { content: "", found: false };
    }

    const sectionNodes = tree.children.slice(range.startIndex, range.endIndex);

    const subtree: Root = { type: "root", children: sectionNodes };
    const content = this.pipeline.stringify(subtree);

    return { content, found: true };
  }
}
