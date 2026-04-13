import { describe, it, expect, vi } from "vitest";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IReadByHeadingUseCase } from "./read-by-heading.js";
import { BulkReadUseCase } from "./bulk-read.js";

// ── Mocks ──────────────────────────────────────────────────────────

function mockFs(files: Record<string, string>): IFileSystemAdapter {
  return {
    listNotes: vi.fn(),
    readNote: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`Note not found: ${path}`);
      return content;
    }),
    writeNote: vi.fn(),
    deleteNote: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
  } as unknown as IFileSystemAdapter;
}

function mockReadByHeading(
  results: Record<string, { content: string; found: boolean }>,
): IReadByHeadingUseCase {
  return {
    execute: vi.fn(async (req: { path: string; heading: string }) => {
      const key = `${req.path}#${req.heading}`;
      const result = results[key];
      if (!result) throw new Error(`Note not found: ${req.path}`);
      return result;
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("BulkReadUseCase", () => {
  it("reads a mixed batch of full files and heading-scoped reads", async () => {
    const fs = mockFs({
      "doc1.md": "# Doc 1\n\nFull content.\n",
    });
    const headingReader = mockReadByHeading({
      "doc2.md#Setup": { content: "## Setup\n\nSetup content.\n", found: true },
    });

    const useCase = new BulkReadUseCase(fs, headingReader);
    const response = await useCase.execute({
      items: [
        { path: "doc1.md" },
        { path: "doc2.md", heading: "Setup" },
      ],
    });

    expect(response.results).toHaveLength(2);

    expect(response.results[0]!.path).toBe("doc1.md");
    expect(response.results[0]!.found).toBe(true);
    expect(response.results[0]!.content).toBe("# Doc 1\n\nFull content.\n");

    expect(response.results[1]!.path).toBe("doc2.md");
    expect(response.results[1]!.heading).toBe("Setup");
    expect(response.results[1]!.found).toBe(true);
    expect(response.results[1]!.content).toContain("Setup content.");
  });

  it("handles partial failure without throwing", async () => {
    const fs = mockFs({
      "exists.md": "# Exists\n\nContent.\n",
    });
    const headingReader = mockReadByHeading({});

    const useCase = new BulkReadUseCase(fs, headingReader);
    const response = await useCase.execute({
      items: [
        { path: "exists.md" },
        { path: "missing.md" },
      ],
    });

    expect(response.results).toHaveLength(2);

    expect(response.results[0]!.path).toBe("exists.md");
    expect(response.results[0]!.found).toBe(true);
    expect(response.results[0]!.content).toContain("Content.");

    expect(response.results[1]!.path).toBe("missing.md");
    expect(response.results[1]!.found).toBe(false);
    expect(response.results[1]!.error).toBeDefined();
    expect(response.results[1]!.content).toBeUndefined();
  });

  it("returns empty results for an empty items array", async () => {
    const fs = mockFs({});
    const headingReader = mockReadByHeading({});

    const useCase = new BulkReadUseCase(fs, headingReader);
    const response = await useCase.execute({ items: [] });

    expect(response.results).toEqual([]);
  });
});
