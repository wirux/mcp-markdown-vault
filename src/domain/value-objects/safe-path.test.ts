import { describe, it, expect } from "vitest";
import { SafePath } from "./safe-path.js";
import { PathTraversalError, InvalidNotePathError } from "../errors/index.js";

const VAULT_ROOT = "/vault";

describe("SafePath", () => {
  describe("valid paths", () => {
    it("resolves a simple note path", () => {
      const sp = SafePath.create(VAULT_ROOT, "hello.md");
      expect(sp.absolute).toBe("/vault/hello.md");
      expect(sp.relative).toBe("hello.md");
    });

    it("resolves a nested path", () => {
      const sp = SafePath.create(VAULT_ROOT, "daily/2024-01-01.md");
      expect(sp.absolute).toBe("/vault/daily/2024-01-01.md");
      expect(sp.relative).toBe("daily/2024-01-01.md");
    });

    it("normalizes redundant slashes", () => {
      const sp = SafePath.create(VAULT_ROOT, "daily///note.md");
      expect(sp.relative).toBe("daily/note.md");
    });

    it("normalizes inner . segments", () => {
      const sp = SafePath.create(VAULT_ROOT, "daily/./note.md");
      expect(sp.relative).toBe("daily/note.md");
    });

    it("auto-appends .md extension when missing", () => {
      const sp = SafePath.create(VAULT_ROOT, "inbox/idea");
      expect(sp.relative).toBe("inbox/idea.md");
      expect(sp.absolute).toBe("/vault/inbox/idea.md");
    });

    it("does not double-append .md", () => {
      const sp = SafePath.create(VAULT_ROOT, "inbox/idea.md");
      expect(sp.relative).toBe("inbox/idea.md");
    });

    it("handles vault root with trailing slash", () => {
      const sp = SafePath.create("/vault/", "note.md");
      expect(sp.absolute).toBe("/vault/note.md");
    });

    it("strips leading slashes from relative path", () => {
      const sp = SafePath.create(VAULT_ROOT, "/daily/note.md");
      expect(sp.relative).toBe("daily/note.md");
    });

    it("resolves a directory path (for listNotes)", () => {
      const sp = SafePath.createDirectory(VAULT_ROOT, "daily");
      expect(sp.absolute).toBe("/vault/daily");
      expect(sp.relative).toBe("daily");
    });

    it("resolves empty directory to vault root", () => {
      const sp = SafePath.createDirectory(VAULT_ROOT, "");
      expect(sp.absolute).toBe("/vault");
      expect(sp.relative).toBe("");
    });
  });

  describe("path traversal attacks", () => {
    it("rejects ../", () => {
      expect(() => SafePath.create(VAULT_ROOT, "../etc/passwd")).toThrow(
        PathTraversalError,
      );
    });

    it("rejects ../ buried in the middle", () => {
      expect(() =>
        SafePath.create(VAULT_ROOT, "daily/../../etc/passwd"),
      ).toThrow(PathTraversalError);
    });

    it("rejects .. at the end", () => {
      expect(() => SafePath.create(VAULT_ROOT, "daily/..")).toThrow(
        PathTraversalError,
      );
    });

    it("rejects backslash traversal (Windows-style)", () => {
      expect(() => SafePath.create(VAULT_ROOT, "..\\etc\\passwd")).toThrow(
        PathTraversalError,
      );
    });

    it("rejects URL-encoded traversal (%2e%2e%2f)", () => {
      expect(() =>
        SafePath.create(VAULT_ROOT, "%2e%2e%2fetc/passwd"),
      ).toThrow(PathTraversalError);
    });

    it("rejects double-encoded traversal (%252e%252e%252f)", () => {
      expect(() =>
        SafePath.create(VAULT_ROOT, "%252e%252e%252fetc/passwd"),
      ).toThrow(PathTraversalError);
    });

    it("treats absolute-looking paths as vault-relative (leading / stripped)", () => {
      // /etc/passwd → vault-relative "etc/passwd.md" — safely inside vault
      const sp = SafePath.create(VAULT_ROOT, "/etc/passwd");
      expect(sp.relative).toBe("etc/passwd.md");
      expect(sp.absolute).toBe("/vault/etc/passwd.md");
    });
  });

  describe("invalid paths", () => {
    it("rejects null bytes", () => {
      expect(() => SafePath.create(VAULT_ROOT, "note\0.md")).toThrow(
        InvalidNotePathError,
      );
    });

    it("rejects empty path", () => {
      expect(() => SafePath.create(VAULT_ROOT, "")).toThrow(
        InvalidNotePathError,
      );
    });

    it("rejects whitespace-only path", () => {
      expect(() => SafePath.create(VAULT_ROOT, "   ")).toThrow(
        InvalidNotePathError,
      );
    });
  });
});
