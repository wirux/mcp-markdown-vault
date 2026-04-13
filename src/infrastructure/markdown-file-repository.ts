import type { Root } from "mdast";
import yaml from "js-yaml";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { MarkdownPipeline } from "../use-cases/markdown-pipeline.js";

/**
 * Reads/writes markdown notes via the file system and remark AST pipeline.
 *
 * Composes {@link IFileSystemAdapter} (I/O) with {@link MarkdownPipeline}
 * (parsing/serializing) behind the {@link IMarkdownRepository} port.
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

  async readFrontmatter(filePath: string): Promise<Record<string, unknown>> {
    const tree = await this.getAstByPath(filePath);
    const yamlNode = tree.children.find((n) => n.type === "yaml");
    if (!yamlNode || yamlNode.type !== "yaml") {
      return {};
    }
    const data = yaml.load(yamlNode.value);
    if (typeof data !== "object" || data === null) {
      return {};
    }
    return data as Record<string, unknown>;
  }

  async updateFrontmatter(
    filePath: string,
    dataToMerge: Record<string, unknown>,
  ): Promise<void> {
    const source = await this.fsAdapter.readNote(filePath);
    const tree = this.pipeline.parse(source);
    const yamlNode = tree.children.find((n) => n.type === "yaml");

    if (yamlNode && yamlNode.type === "yaml") {
      const existing = yaml.load(yamlNode.value);
      const merged = Object.assign(
        {},
        typeof existing === "object" && existing !== null ? existing : {},
        dataToMerge,
      );
      yamlNode.value = yaml.dump(merged).trimEnd();
    } else {
      const newYamlValue = yaml.dump(dataToMerge).trimEnd();
      tree.children.unshift({
        type: "yaml",
        value: newYamlValue,
      });
    }

    const result = this.pipeline.stringify(tree);
    await this.fsAdapter.writeNote(filePath, result, true);
  }
}
