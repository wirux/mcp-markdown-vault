import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownPipeline } from "./markdown-pipeline.js";
import { BacklinkIndexService } from "./backlink-index.js";

let service: BacklinkIndexService;

beforeEach(() => {
  service = new BacklinkIndexService(new MarkdownPipeline());
});

describe("BacklinkIndexService", () => {
  it("returns empty result for an empty index", () => {
    const result = service.getBacklinks("any.md");
    expect(result).toEqual([]);
  });

  it("indexes wikilink [[B]] — wikilink type backlink", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [[B]].\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("wikilink");
  });

  it("indexes markdown link [text](B.md) — markdown_link type backlink", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [B doc](b.md).\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("markdown_link");
  });

  it("multiple files linking to the same target", () => {
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

  it("resolves wikilink by filename", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[Note Title]].\n" },
      { path: "folder/Note Title.md", content: "# Note Title\n" },
    ]);

    const backlinks = service.getBacklinks("folder/Note Title.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.sourcePath).toBe("a.md");
    expect(backlinks[0]!.linkType).toBe("wikilink");
  });

  it("updateFile replaces old entries for the source", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[B]].\n" },
      { path: "b.md", content: "# B\n" },
      { path: "c.md", content: "# C\n" },
    ]);

    expect(service.getBacklinks("b.md")).toHaveLength(1);
    expect(service.getBacklinks("c.md")).toHaveLength(0);

    // Change a.md — now links to C instead of B
    service.updateFile("a.md", "Now see [[C]].\n");

    expect(service.getBacklinks("b.md")).toHaveLength(0);
    expect(service.getBacklinks("c.md")).toHaveLength(1);
  });

  it("correctly extracts line number and context", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# Title\n\nFirst paragraph.\n\nSee [[B]] for details.\n" },
      { path: "b.md", content: "# B\n" },
    ]);

    const backlinks = service.getBacklinks("b.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.lineNumber).toBe(5);
    expect(backlinks[0]!.context).toContain("[[B]]");
  });

  it("skips self-links", () => {
    service.rebuildIndex([
      { path: "a.md", content: "# A\n\nSee [[A]] and [self](a.md).\n" },
    ]);

    const backlinks = service.getBacklinks("a.md");
    expect(backlinks).toHaveLength(0);
  });

  it("removeFile removes backlink entries from that source", () => {
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

  it("target normalization is case-insensitive", () => {
    service.rebuildIndex([
      { path: "a.md", content: "See [[B]].\n" },
      { path: "B.md", content: "# B\n" },
    ]);

    // Query with uppercase
    expect(service.getBacklinks("B.md")).toHaveLength(1);
    // Query with lowercase
    expect(service.getBacklinks("b.md")).toHaveLength(1);
  });
});
