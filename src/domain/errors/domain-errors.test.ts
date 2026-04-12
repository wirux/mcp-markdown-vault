import { describe, it, expect } from "vitest";
import {
  DomainError,
  VaultNotFoundError,
  PathTraversalError,
  NoteNotFoundError,
  NoteAlreadyExistsError,
  InvalidNotePathError,
  AstPatchError,
  HeadingNotFoundError,
  BlockNotFoundError,
  EmbeddingError,
  VectorDbError,
  StateTransitionError,
} from "./index.js";

describe("DomainError (base class)", () => {
  it("extends Error", () => {
    const err = new DomainError("TEST_CODE", "something broke");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
  });

  it("carries a machine-readable code and human message", () => {
    const err = new DomainError("TEST_CODE", "human-readable detail");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("human-readable detail");
    expect(err.name).toBe("DomainError");
  });

  it("captures a stack trace", () => {
    const err = new DomainError("X", "y");
    expect(err.stack).toBeDefined();
  });

  it("optionally wraps a cause", () => {
    const cause = new Error("root cause");
    const err = new DomainError("WRAP", "wrapped", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("VaultNotFoundError", () => {
  it("has code VAULT_NOT_FOUND and includes the vault path", () => {
    const err = new VaultNotFoundError("/missing/vault");
    expect(err.code).toBe("VAULT_NOT_FOUND");
    expect(err.message).toContain("/missing/vault");
    expect(err.name).toBe("VaultNotFoundError");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("PathTraversalError", () => {
  it("has code PATH_TRAVERSAL and includes the offending path", () => {
    const err = new PathTraversalError("../../etc/passwd");
    expect(err.code).toBe("PATH_TRAVERSAL");
    expect(err.message).toContain("../../etc/passwd");
    expect(err.name).toBe("PathTraversalError");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("NoteNotFoundError", () => {
  it("has code NOTE_NOT_FOUND and includes the note path", () => {
    const err = new NoteNotFoundError("daily/2024-01-01.md");
    expect(err.code).toBe("NOTE_NOT_FOUND");
    expect(err.message).toContain("daily/2024-01-01.md");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("NoteAlreadyExistsError", () => {
  it("has code NOTE_ALREADY_EXISTS", () => {
    const err = new NoteAlreadyExistsError("inbox/idea.md");
    expect(err.code).toBe("NOTE_ALREADY_EXISTS");
    expect(err.message).toContain("inbox/idea.md");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("InvalidNotePathError", () => {
  it("has code INVALID_NOTE_PATH", () => {
    const err = new InvalidNotePathError("foo\0bar.md");
    expect(err.code).toBe("INVALID_NOTE_PATH");
    expect(err.message).toContain("foo\0bar.md");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("AstPatchError", () => {
  it("has code AST_PATCH_FAILED", () => {
    const err = new AstPatchError("replace failed on node 4");
    expect(err.code).toBe("AST_PATCH_FAILED");
    expect(err.message).toContain("replace failed on node 4");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("HeadingNotFoundError", () => {
  it("has code HEADING_NOT_FOUND and includes heading title", () => {
    const err = new HeadingNotFoundError("References", 2);
    expect(err.code).toBe("HEADING_NOT_FOUND");
    expect(err.message).toContain("References");
    expect(err.message).toContain("2");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("BlockNotFoundError", () => {
  it("has code BLOCK_NOT_FOUND and includes block id", () => {
    const err = new BlockNotFoundError("abc123");
    expect(err.code).toBe("BLOCK_NOT_FOUND");
    expect(err.message).toContain("abc123");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("EmbeddingError", () => {
  it("has code EMBEDDING_FAILED", () => {
    const cause = new Error("Ollama unreachable");
    const err = new EmbeddingError("embedding generation failed", cause);
    expect(err.code).toBe("EMBEDDING_FAILED");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("VectorDbError", () => {
  it("has code VECTOR_DB_ERROR", () => {
    const err = new VectorDbError("index corrupt");
    expect(err.code).toBe("VECTOR_DB_ERROR");
    expect(err).toBeInstanceOf(DomainError);
  });
});

describe("StateTransitionError", () => {
  it("has code INVALID_STATE_TRANSITION and includes from/to states", () => {
    const err = new StateTransitionError("idle", "reviewing");
    expect(err.code).toBe("INVALID_STATE_TRANSITION");
    expect(err.message).toContain("idle");
    expect(err.message).toContain("reviewing");
    expect(err).toBeInstanceOf(DomainError);
  });
});
