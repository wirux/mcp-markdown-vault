import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { BacklinkIndexService } from "./backlink-index.js";

let service: BacklinkIndexService;

beforeEach(() => {
  service = new BacklinkIndexService(new MarkdownPipeline());
});

describe("BacklinkIndexService", () => {
  it("zwraca pusty wynik dla pustego indeksu", () => {
    const result = service.getBacklinks("any.md");
    expect(result).toEqual([]);
  });

  it("indeksuje wikilink [[B]] — backlink typu wikilink", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [[B]].\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("wikilink");
  });

  it("indeksuje markdown link [text](B.md) — backlink typu markdown_link", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [B doc](b.md).\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("markdown_link");
  });

  it("wiele plików linkujących do tego samego celu", () => {
    service.rebuildIndex([
      { path: "a.md", content: "Link to [[C]].\n" },
      { path: "b.md", content: "Also links to [[C]].\n" },
      { path: "c.md", content: "# C\n" },
    ]);

    const backlinks = service.getBacklinks("c.md");
    expect(backlinks).toHaveLength(2);
    const sources = backlinks.map((b) => b.sourcePath).sort();
    expect(sources).toEqual(["a.md", "b.md"]);
  });

  it("rozwiązuje wikilink po nazwie pliku", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[Note Title]].\n" },
      { path: "folder/Note Title.md", content: "# Note Title\n" },
    ]);

    const backlinks = service.getBacklinks("folder/Note Title.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("wikilink");
  });

  it("updateFile zastępuje stare wpisy dla tego źródła", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[B]].\n" },
      { path: "b.md", content: "# B\n" },
      { path: "c.md", content: "# C\n" },
    ]);

    expect(service.getBacklinks("b.md")).toHaveLength(1);
    expect(service.getBacklinks("c.md")).toHaveLength(0);

    // Zmień a.md — teraz linkuje do C zamiast B
    service.updateFile("a.md", "Now see [[C]].\n");

    expect(service.getBacklinks("b.md")).toHaveLength(0);
    expect(service.getBacklinks("c.md")).toHaveLength(1);
  });

  it("poprawnie wyodrębnia numer linii i kontekst", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# Title\n\nFirst paragraph.\n\nSee [[B]] for details.\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.lineNumber).toBe(5);
    expect(backlinks[0]!.context).toContain("[[B]]");
  });

  it("pomija self-linki", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [[A]] and [self](a.md).\n" },
    ]);

    const backlinks = service.getBacklinks("a.md");
    expect(backlinks).toHaveLength(0);
  });

  it("removeFile usuwa wpisy backlinków z tego źródła", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[C]].\n" },
      { path: "b.md", content: "Also [[C]].\n" },
      { path: "c.md", content: "# C\n" },
    ]);

    expect(service.getBacklinks("c.md")).toHaveLength(2);

    service.removeFile("a.md");

    const remaining = service.getBacklinks("c.md");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.sourcePath).toBe("b.md");
  });

  it("normalizacja celu niezależna od wielkości liter", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[B]].\n" },
      { path: "B.md", content: "# B\n" },
    ]);

    // Zapytanie z wielką literą
    expect(service.getBacklinks("B.md")).toHaveLength(1);
    // Zapytanie z małą literą
    expect(service.getBacklinks("b.md")).toHaveLength(1);
  });
});
