import { describe, it, expect } from "vitest";
import { WikilinkResolver } from "./wikilink-resolver.js";

// Simulates a vault file listing
const VAULT_FILES = [
  "inbox/quick-note.md",
  "projects/mcp-server/architecture.md",
  "projects/mcp-server/readme.md",
  "projects/web-app/architecture.md",
  "daily/2024-01-15.md",
  "daily/2024-01-16.md",
  "templates/daily.md",
  "readme.md",
];

describe("WikilinkResolver", () => {
  const resolver = new WikilinkResolver(VAULT_FILES);

  describe("exact filename match (shortest path)", () => {
    it("resolves [[quick-note]] to the only matching file", () => {
      expect(resolver.resolve("quick-note")).toBe("inbox/quick-note.md");
    });

    it("resolves [[daily]] to shortest path when multiple could match", () => {
      // templates/daily.md is the exact match for "daily"
      expect(resolver.resolve("daily")).toBe("templates/daily.md");
    });
  });

  describe("ambiguous matches — shortest path wins", () => {
    it("resolves [[architecture]] to the shortest path among matches", () => {
      const result = resolver.resolve("architecture");
      // Both projects/mcp-server/architecture.md and projects/web-app/architecture.md match
      // They have equal depth — alphabetically first wins as tiebreaker
      expect(result).toBe("projects/mcp-server/architecture.md");
    });

    it("resolves [[readme]] to root-level file (shortest path)", () => {
      expect(resolver.resolve("readme")).toBe("readme.md");
    });
  });

  describe("partial path resolution", () => {
    it("resolves [[mcp-server/architecture]] to the correct file", () => {
      expect(resolver.resolve("mcp-server/architecture")).toBe(
        "projects/mcp-server/architecture.md",
      );
    });

    it("resolves [[web-app/architecture]] to the correct file", () => {
      expect(resolver.resolve("web-app/architecture")).toBe(
        "projects/web-app/architecture.md",
      );
    });
  });

  describe("with .md extension", () => {
    it("handles links that already include .md", () => {
      expect(resolver.resolve("quick-note.md")).toBe("inbox/quick-note.md");
    });
  });

  describe("no match", () => {
    it("returns null for non-existent note", () => {
      expect(resolver.resolve("nonexistent")).toBeNull();
    });
  });

  describe("heading/block anchors", () => {
    it("strips #heading from link before resolving", () => {
      expect(resolver.resolve("quick-note#section")).toBe(
        "inbox/quick-note.md",
      );
    });

    it("strips ^block-id from link before resolving", () => {
      expect(resolver.resolve("quick-note#^block1")).toBe(
        "inbox/quick-note.md",
      );
    });
  });

  describe("extractWikilinks", () => {
    it("extracts all [[wikilinks]] from markdown text", () => {
      const md =
        "See [[quick-note]] and [[architecture#Design]] for details. Also [[nonexistent]].";
      const links = WikilinkResolver.extractWikilinks(md);
      expect(links).toEqual([
        "quick-note",
        "architecture#Design",
        "nonexistent",
      ]);
    });

    it("handles [[link|alias]] syntax", () => {
      const md = "Check [[readme|the readme file]].";
      const links = WikilinkResolver.extractWikilinks(md);
      expect(links).toEqual(["readme"]);
    });

    it("returns empty array when no wikilinks", () => {
      expect(WikilinkResolver.extractWikilinks("No links here.")).toEqual([]);
    });
  });
});
