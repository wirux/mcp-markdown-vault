import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalFileSystemAdapter } from "./local-fs-adapter.js";
import {
  NoteNotFoundError,
  NoteAlreadyExistsError,
  PathTraversalError,
  VaultNotFoundError,
} from "../domain/errors/index.js";

let vaultDir: string;
let adapter: LocalFileSystemAdapter;

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-"));
  adapter = await LocalFileSystemAdapter.create(vaultDir);
});

afterEach(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
});

// ── Factory ────────────────────────────────────────────────────────

describe("LocalFileSystemAdapter.create", () => {
  it("throws VaultNotFoundError if vault directory does not exist", async () => {
    await expect(
      LocalFileSystemAdapter.create("/tmp/nonexistent-vault-abc123"),
    ).rejects.toThrow(VaultNotFoundError);
  });

  it("throws VaultNotFoundError if path points to a file, not directory", async () => {
    const filePath = path.join(vaultDir, "not-a-dir.txt");
    await fs.writeFile(filePath, "hello");
    await expect(LocalFileSystemAdapter.create(filePath)).rejects.toThrow(
      VaultNotFoundError,
    );
  });
});

// ── writeNote ──────────────────────────────────────────────────────

describe("writeNote", () => {
  it("creates a new note", async () => {
    await adapter.writeNote("hello.md", "# Hello\n");
    const content = await fs.readFile(path.join(vaultDir, "hello.md"), "utf-8");
    expect(content).toBe("# Hello\n");
  });

  it("creates parent directories automatically", async () => {
    await adapter.writeNote("daily/2024/01/01.md", "journal entry");
    const content = await fs.readFile(
      path.join(vaultDir, "daily/2024/01/01.md"),
      "utf-8",
    );
    expect(content).toBe("journal entry");
  });

  it("overwrites existing note when overwrite=true", async () => {
    await adapter.writeNote("note.md", "v1");
    await adapter.writeNote("note.md", "v2", true);
    const content = await fs.readFile(path.join(vaultDir, "note.md"), "utf-8");
    expect(content).toBe("v2");
  });

  it("throws NoteAlreadyExistsError when overwrite=false (default)", async () => {
    await adapter.writeNote("note.md", "v1");
    await expect(adapter.writeNote("note.md", "v2")).rejects.toThrow(
      NoteAlreadyExistsError,
    );
  });

  it("writes atomically (temp file + rename)", async () => {
    // Write a note and verify no leftover temp files
    await adapter.writeNote("atomic.md", "content");
    const files = await fs.readdir(vaultDir);
    expect(files).toEqual(["atomic.md"]);
  });

  it("rejects path traversal", async () => {
    await expect(
      adapter.writeNote("../escape.md", "bad"),
    ).rejects.toThrow(PathTraversalError);
  });
});

// ── readNote ───────────────────────────────────────────────────────

describe("readNote", () => {
  it("reads an existing note", async () => {
    await fs.writeFile(path.join(vaultDir, "existing.md"), "hello world");
    const content = await adapter.readNote("existing.md");
    expect(content).toBe("hello world");
  });

  it("throws NoteNotFoundError for missing note", async () => {
    await expect(adapter.readNote("nope.md")).rejects.toThrow(
      NoteNotFoundError,
    );
  });

  it("rejects path traversal", async () => {
    await expect(adapter.readNote("../../etc/passwd")).rejects.toThrow(
      PathTraversalError,
    );
  });
});

// ── deleteNote ─────────────────────────────────────────────────────

describe("deleteNote", () => {
  it("deletes an existing note", async () => {
    await fs.writeFile(path.join(vaultDir, "doomed.md"), "bye");
    await adapter.deleteNote("doomed.md");
    await expect(
      fs.access(path.join(vaultDir, "doomed.md")),
    ).rejects.toThrow();
  });

  it("throws NoteNotFoundError for missing note", async () => {
    await expect(adapter.deleteNote("nope.md")).rejects.toThrow(
      NoteNotFoundError,
    );
  });

  it("rejects path traversal", async () => {
    await expect(adapter.deleteNote("../../../tmp/x.md")).rejects.toThrow(
      PathTraversalError,
    );
  });
});

// ── exists ─────────────────────────────────────────────────────────

describe("exists", () => {
  it("returns true for existing note", async () => {
    await fs.writeFile(path.join(vaultDir, "yes.md"), "");
    expect(await adapter.exists("yes.md")).toBe(true);
  });

  it("returns false for missing note", async () => {
    expect(await adapter.exists("no.md")).toBe(false);
  });
});

// ── stat ───────────────────────────────────────────────────────────

describe("stat", () => {
  it("returns size and modified time", async () => {
    const content = "hello world"; // 11 bytes
    await fs.writeFile(path.join(vaultDir, "info.md"), content);
    const stat = await adapter.stat("info.md");
    expect(stat.sizeBytes).toBe(11);
    expect(new Date(stat.modifiedAt).getTime()).toBeGreaterThan(0);
  });

  it("throws NoteNotFoundError for missing note", async () => {
    await expect(adapter.stat("nope.md")).rejects.toThrow(NoteNotFoundError);
  });
});

// ── listNotes ──────────────────────────────────────────────────────

describe("listNotes", () => {
  it("lists all .md files recursively", async () => {
    await fs.mkdir(path.join(vaultDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "root.md"), "");
    await fs.writeFile(path.join(vaultDir, "sub/nested.md"), "");
    await fs.writeFile(path.join(vaultDir, "ignored.txt"), "");

    const notes = await adapter.listNotes();
    expect(notes).toEqual(["root.md", "sub/nested.md"]);
  });

  it("lists only within a subdirectory", async () => {
    await fs.mkdir(path.join(vaultDir, "daily"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "root.md"), "");
    await fs.writeFile(path.join(vaultDir, "daily/jan.md"), "");

    const notes = await adapter.listNotes("daily");
    expect(notes).toEqual(["daily/jan.md"]);
  });

  it("returns empty array for empty vault", async () => {
    const notes = await adapter.listNotes();
    expect(notes).toEqual([]);
  });

  it("returns empty array for missing subdirectory", async () => {
    const notes = await adapter.listNotes("nonexistent");
    expect(notes).toEqual([]);
  });

  it("rejects path traversal in directory argument", async () => {
    await expect(adapter.listNotes("../..")).rejects.toThrow(
      PathTraversalError,
    );
  });
});
