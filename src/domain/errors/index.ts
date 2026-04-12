/**
 * Base class for all domain errors.
 * Carries a machine-readable `code` for programmatic handling
 * and a human-readable `message` for logging/debugging.
 */
export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string, cause?: Error) {
    super(message, { cause });
    this.code = code;
    this.name = "DomainError";
  }
}

// ── File-system / Vault errors ──────────────────────────────────────

export class VaultNotFoundError extends DomainError {
  constructor(vaultPath: string) {
    super("VAULT_NOT_FOUND", `Vault not found at path: ${vaultPath}`);
    this.name = "VaultNotFoundError";
  }
}

export class PathTraversalError extends DomainError {
  constructor(path: string) {
    super("PATH_TRAVERSAL", `Path traversal detected: ${path}`);
    this.name = "PathTraversalError";
  }
}

export class NoteNotFoundError extends DomainError {
  constructor(notePath: string) {
    super("NOTE_NOT_FOUND", `Note not found: ${notePath}`);
    this.name = "NoteNotFoundError";
  }
}

export class NoteAlreadyExistsError extends DomainError {
  constructor(notePath: string) {
    super("NOTE_ALREADY_EXISTS", `Note already exists: ${notePath}`);
    this.name = "NoteAlreadyExistsError";
  }
}

export class InvalidNotePathError extends DomainError {
  constructor(notePath: string) {
    super("INVALID_NOTE_PATH", `Invalid note path: ${notePath}`);
    this.name = "InvalidNotePathError";
  }
}

// ── AST / Parsing errors ───────────────────────────────────────────

export class AstPatchError extends DomainError {
  constructor(detail: string, cause?: Error) {
    super("AST_PATCH_FAILED", `AST patch failed: ${detail}`, cause);
    this.name = "AstPatchError";
  }
}

export class HeadingNotFoundError extends DomainError {
  constructor(title: string, depth: number) {
    super(
      "HEADING_NOT_FOUND",
      `Heading not found: "${title}" at depth ${depth}`,
    );
    this.name = "HeadingNotFoundError";
  }
}

export class BlockNotFoundError extends DomainError {
  constructor(blockId: string) {
    super("BLOCK_NOT_FOUND", `Block not found: ${blockId}`);
    this.name = "BlockNotFoundError";
  }
}

// ── Freeform editing errors ───────────────────────────────────────

export class FreeformEditError extends DomainError {
  constructor(detail: string) {
    super("FREEFORM_EDIT_FAILED", `Freeform edit failed: ${detail}`);
    this.name = "FreeformEditError";
  }
}

// ── Embedding / Vector errors ──────────────────────────────────────

export class EmbeddingError extends DomainError {
  constructor(detail: string, cause?: Error) {
    super("EMBEDDING_FAILED", `Embedding failed: ${detail}`, cause);
    this.name = "EmbeddingError";
  }
}

export class VectorDbError extends DomainError {
  constructor(detail: string, cause?: Error) {
    super("VECTOR_DB_ERROR", `Vector DB error: ${detail}`, cause);
    this.name = "VectorDbError";
  }
}

// ── Workflow / State errors ────────────────────────────────────────

export class StateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      "INVALID_STATE_TRANSITION",
      `Invalid state transition from "${from}" to "${to}"`,
    );
    this.name = "StateTransitionError";
  }
}
