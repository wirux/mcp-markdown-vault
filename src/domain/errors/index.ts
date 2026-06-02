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

// ── Frontmatter errors ────────────────────────────────────────────

export class InvalidFrontmatterPayloadError extends DomainError {
  constructor(detail: string) {
    super(
      "INVALID_FRONTMATTER_PAYLOAD",
      `Invalid frontmatter payload: ${detail}`,
    );
    this.name = "InvalidFrontmatterPayloadError";
  }
}

// ── Batch errors ─────────────────────────────────────────────────

export class BatchLimitExceededError extends DomainError {
  constructor(count: number, limit: number) {
    super(
      "BATCH_LIMIT_EXCEEDED",
      `Batch limit exceeded: ${count} operations requested, max ${limit} allowed`,
    );
    this.name = "BatchLimitExceededError";
  }
}

// ── Authentication errors ─────────────────────────────────────────

export class AuthenticationError extends DomainError {
  constructor(detail: string) {
    super("AUTHENTICATION_FAILED", `Authentication failed: ${detail}`);
    this.name = "AuthenticationError";
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

// ── Security errors ───────────────────────────────────────────────

export class AbsolutePathError extends DomainError {
  constructor(path: string) {
    super("ABSOLUTE_PATH_REJECTED", `Absolute path rejected: ${path}`);
    this.name = "AbsolutePathError";
  }
}

export class SymlinkEscapeError extends DomainError {
  constructor(resolvedPath: string) {
    super(
      "SYMLINK_ESCAPE_DETECTED",
      `Symlink escapes vault boundary: ${resolvedPath}`,
    );
    this.name = "SymlinkEscapeError";
  }
}

// ── Argument errors ───────────────────────────────────────────────

export class InvalidArgumentError extends DomainError {
  constructor(argumentName: string) {
    super("INVALID_ARGUMENT", `Required argument missing: ${argumentName}`);
    this.name = "InvalidArgumentError";
  }
}

// ── Config errors ─────────────────────────────────────────────────

export class InvalidConfigError extends DomainError {
  constructor(detail: string) {
    super("INVALID_CONFIG", `Invalid configuration: ${detail}`);
    this.name = "InvalidConfigError";
  }
}

// ── Edit UX / Heading-operation errors ───────────────────────────

/** Thrown when a heading target is ambiguous due to duplicate headings. */
export class AmbiguousHeadingTargetError extends DomainError {
  public readonly candidates: ReadonlyArray<{ title: string; depth: number; index: number }>;

  constructor(
    title: string,
    depth: number,
    candidates: ReadonlyArray<{ title: string; depth: number; index: number }>,
  ) {
    super(
      "AMBIGUOUS_HEADING_TARGET",
      `Ambiguous heading target: "${title}" at depth ${depth} matches ${candidates.length} headings. ` +
        `Use blockId targeting to disambiguate. ` +
        `Add block IDs like "^my-id" to the relevant heading sections first, ` +
        `then reference via blockId instead of heading text.`,
    );
    this.name = "AmbiguousHeadingTargetError";
    this.candidates = candidates;
  }
}

/** Thrown when a delete target is structurally unsafe (e.g., would remove the entire document). */
export class UnsafeDeleteTargetError extends DomainError {
  constructor(detail: string) {
    super("UNSAFE_DELETE_TARGET", `Unsafe delete target: ${detail}`);
    this.name = "UnsafeDeleteTargetError";
  }
}

/** Thrown when directory outline exceeds configured file or heading limits. */
export class OutlineLimitExceededError extends DomainError {
  constructor(detail: string) {
    super("OUTLINE_LIMIT_EXCEEDED", `Outline limit exceeded: ${detail}`);
    this.name = "OutlineLimitExceededError";
  }
}
