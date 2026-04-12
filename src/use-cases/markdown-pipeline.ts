import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root } from "mdast";

/**
 * Configured unified pipeline for parsing and serializing Obsidian-flavoured
 * Markdown (GFM + YAML frontmatter).
 *
 * Stateless — safe to share across requests.
 */
export class MarkdownPipeline {
  private readonly parser;
  private readonly serializer;

  constructor() {
    const base = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ["yaml"]);

    this.parser = base;
    this.serializer = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkStringify, {
        bullet: "*",
        emphasis: "_",
        strong: "*",
        listItemIndent: "one",
        rule: "-",
      });
  }

  /** Parse markdown source into an mdast Root tree. */
  parse(markdown: string): Root {
    return this.parser.parse(markdown) as Root;
  }

  /** Serialize an mdast Root tree back to markdown string. */
  stringify(tree: Root): string {
    return this.serializer.stringify(tree);
  }
}
