import type { Root } from "mdast";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import type { MarkdownPipeline } from "./markdown-pipeline.js";
import { AstNavigator } from "./ast-navigation.js";
import { FuzzyMatcher } from "./fuzzy-match.js";

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
  /** Fuzzy-matched heading suggestions when found is false. */
  suggestions?: string[] | undefined;
  /** Guidance to help agents find the correct heading. */
  guidance?: string | undefined;
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
      const allHeadings = AstNavigator.findAllHeadings(tree);
      const candidates = allHeadings.filter((h) => h.depth === depth).map((h) => h.title);
      const matches = FuzzyMatcher.allMatches(request.heading, candidates, 0.5);
      return {
        content: "",
        found: false,
        suggestions: matches.map((m) => m.match).slice(0, 3),
        guidance: "Use view.outline to list available headings first",
      };
    }

    const sectionNodes = tree.children.slice(range.startIndex, range.endIndex);

    const subtree: Root = { type: "root", children: sectionNodes };
    const content = this.pipeline.stringify(subtree);

    return { content, found: true };
  }
}
