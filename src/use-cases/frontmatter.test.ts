import { describe, it, expect, vi } from "vitest";
import type { Root } from "mdast";
import type { IMarkdownRepository } from "../domain/interfaces/markdown-repository.js";
import { InvalidFrontmatterPayloadError } from "../domain/errors/index.js";
import { GetFrontmatterUseCase, SetFrontmatterUseCase } from "./frontmatter.js";

// ── Helper: mock repository ────────────────────────────────────────

function mockRepo(
  frontmatter: Record<string, unknown> = {},
): IMarkdownRepository {
  return {
    getAstByPath: async (_path: string): Promise<Root> => ({
      type: "root",
      children: [],
    }),
    readFrontmatter: vi.fn().mockResolvedValue(frontmatter),
    updateFrontmatter: vi.fn().mockResolvedValue(undefined),
  };
}

// ── GetFrontmatterUseCase ──────────────────────────────────────────

describe("GetFrontmatterUseCase", () => {
  it("returns frontmatter when file has metadata", async () => {
    const data = { tags: ["mcp"], status: "draft" };
    const repo = mockRepo(data);
    const useCase = new GetFrontmatterUseCase(repo);

    const result = await useCase.execute({ path: "note.md" });

    expect(result.frontmatter).toEqual({ tags: ["mcp"], status: "draft" });
    expect(repo.readFrontmatter).toHaveBeenCalledWith("note.md");
  });

  it("returns empty object when file has no frontmatter", async () => {
    const repo = mockRepo({});
    const useCase = new GetFrontmatterUseCase(repo);

    const result = await useCase.execute({ path: "note.md" });

    expect(result.frontmatter).toEqual({});
  });
});

// ── SetFrontmatterUseCase ──────────────────────────────────────────

describe("SetFrontmatterUseCase", () => {
  it("parses JSON and delegates to repository for updating existing key", async () => {
    const repo = mockRepo();
    const useCase = new SetFrontmatterUseCase(repo);

    await useCase.execute({
      path: "note.md",
      content: '{"status": "published"}',
    });

    expect(repo.updateFrontmatter).toHaveBeenCalledWith("note.md", {
      status: "published",
    });
  });

  it("parses JSON and delegates to repository for adding new key", async () => {
    const repo = mockRepo();
    const useCase = new SetFrontmatterUseCase(repo);

    await useCase.execute({
      path: "note.md",
      content: '{"category": "guide", "priority": 1}',
    });

    expect(repo.updateFrontmatter).toHaveBeenCalledWith("note.md", {
      category: "guide",
      priority: 1,
    });
  });

  it("throws InvalidFrontmatterPayloadError for invalid JSON", async () => {
    const repo = mockRepo();
    const useCase = new SetFrontmatterUseCase(repo);

    await expect(
      useCase.execute({ path: "note.md", content: "not valid json {{{" }),
    ).rejects.toThrow(InvalidFrontmatterPayloadError);

    expect(repo.updateFrontmatter).not.toHaveBeenCalled();
  });
});
