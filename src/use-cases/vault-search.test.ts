import { describe, it, expect, vi } from "vitest";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { VaultSearcher } from "./vault-search.js";

function createMockFs(
  files: Record<string, string>,
): IFileSystemAdapter {
  return {
    listNotes: vi.fn(async () => Object.keys(files)),
    readNote: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`Not found: ${path}`);
      return content;
    }),
    writeNote: vi.fn(),
    deleteNote: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
  } as unknown as IFileSystemAdapter;
}

describe("VaultSearcher", () => {
  const testVault: Record<string, string> = {
    "physics/quantum.md": [
      "# Quantum Physics",
      "",
      "Quantum mechanics describes particle behavior at the atomic level.",
      "",
      "## Entanglement",
      "",
      "Quantum entanglement links particles across vast distances.",
    ].join("\n"),
    "cooking/recipes.md": [
      "# Cooking Recipes",
      "",
      "## Pasta Carbonara",
      "",
      "Boil water, add salt, cook pasta for 10 minutes. Mix eggs and cheese.",
      "",
      "## Garden Salad",
      "",
      "Fresh vegetables with olive oil and balsamic vinegar.",
    ].join("\n"),
    "programming/typescript.md": [
      "# TypeScript Guide",
      "",
      "## Type System",
      "",
      "TypeScript adds static types to JavaScript.",
      "It helps catch bugs at compile time.",
      "",
      "## Generics",
      "",
      "Generics enable reusable type-safe components.",
    ].join("\n"),
  };

  it("returns ranked results across multiple files", async () => {
    const fs = createMockFs(testVault);
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("quantum entanglement");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filePath).toBe("physics/quantum.md");
  });

  it("includes filePath and headingPath in results", async () => {
    const fs = createMockFs(testVault);
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("pasta");

    expect(results.length).toBeGreaterThan(0);
    const pasta = results.find((r) => r.filePath === "cooking/recipes.md");
    expect(pasta).toBeDefined();
    expect(pasta!.headingPath).toContain("Pasta Carbonara");
  });

  it("ranks exact keyword matches above unrelated content", async () => {
    const fs = createMockFs(testVault);
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("TypeScript generics");

    expect(results[0]!.filePath).toBe("programming/typescript.md");
  });

  it("respects maxResults limit", async () => {
    const fs = createMockFs(testVault);
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("the", { maxResults: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array for no matches", async () => {
    const fs = createMockFs(testVault);
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("xyznonexistent");

    expect(results).toEqual([]);
  });

  it("returns empty array for empty vault", async () => {
    const fs = createMockFs({});
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("anything");

    expect(results).toEqual([]);
  });

  it("handles files with no headings (flat content)", async () => {
    const fs = createMockFs({
      "flat.md": "Just plain text without any headings or structure.",
    });
    const searcher = new VaultSearcher(fs);

    const results = await searcher.search("plain text");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filePath).toBe("flat.md");
  });

  it("skips unreadable files gracefully", async () => {
    const files = { ...testVault };
    const fs = createMockFs(files);
    // Make one file throw on read
    (fs.readNote as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string) => {
        if (path === "physics/quantum.md") throw new Error("Permission denied");
        const content = files[path];
        if (content === undefined) throw new Error(`Not found: ${path}`);
        return content;
      },
    );

    const results = await searcher(fs, "pasta");

    expect(results.length).toBeGreaterThan(0);
    // Should still find results from other files
    expect(results.every((r) => r.filePath !== "physics/quantum.md")).toBe(
      true,
    );
  });
});

// Helper for the "skips unreadable files" test
async function searcher(
  fs: IFileSystemAdapter,
  query: string,
) {
  const s = new VaultSearcher(fs);
  return s.search(query);
}
