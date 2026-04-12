import path from "node:path";
import {
  PathTraversalError,
  InvalidNotePathError,
} from "../errors/index.js";

/**
 * Immutable value object that guarantees a vault-relative path is safe.
 *
 * Construction validates against:
 * - Path traversal (../, encoded variants, backslash)
 * - Null bytes
 * - Empty / whitespace-only paths
 * - Absolute paths escaping the vault
 */
export class SafePath {
  /** Fully resolved absolute path within the vault */
  public readonly absolute: string;
  /** Vault-relative path (forward slashes, no leading slash) */
  public readonly relative: string;

  private constructor(absolute: string, relative: string) {
    this.absolute = absolute;
    this.relative = relative;
  }

  /** Create a SafePath for a note file (auto-appends .md if missing). */
  static create(vaultRoot: string, notePath: string): SafePath {
    const sanitized = sanitize(notePath);

    if (sanitized.length === 0) {
      throw new InvalidNotePathError(notePath);
    }

    const withExt = sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
    return SafePath.resolve(vaultRoot, withExt, notePath);
  }

  /** Create a SafePath for a directory (no .md extension added). */
  static createDirectory(vaultRoot: string, dirPath: string): SafePath {
    const normalizedRoot = path.resolve(vaultRoot);

    if (!dirPath || dirPath.trim().length === 0) {
      return new SafePath(normalizedRoot, "");
    }

    const sanitized = sanitize(dirPath);
    return SafePath.resolve(vaultRoot, sanitized, dirPath);
  }

  private static resolve(
    vaultRoot: string,
    cleanPath: string,
    originalInput: string,
  ): SafePath {
    const normalizedRoot = path.resolve(vaultRoot);
    const absolute = path.resolve(normalizedRoot, cleanPath);

    // The resolved path must start with the vault root
    if (!absolute.startsWith(normalizedRoot + path.sep) && absolute !== normalizedRoot) {
      throw new PathTraversalError(originalInput);
    }

    const relative = path.relative(normalizedRoot, absolute);

    // Double-check: relative path must not start with ".."
    if (relative.startsWith("..")) {
      throw new PathTraversalError(originalInput);
    }

    return new SafePath(absolute, relative);
  }
}

/**
 * Sanitize user input before path resolution.
 * Catches encoding tricks that path.resolve alone would miss.
 */
function sanitize(input: string): string {
  // Reject null bytes
  if (input.includes("\0")) {
    throw new InvalidNotePathError(input);
  }

  // Reject whitespace-only
  if (input.trim().length === 0) {
    throw new InvalidNotePathError(input);
  }

  // Decode percent-encoded characters (handles double-encoding too)
  let decoded = input;
  let prev: string;
  do {
    prev = decoded;
    decoded = decodeURIComponent(decoded);
  } while (decoded !== prev);

  // Normalize backslashes to forward slashes
  decoded = decoded.replace(/\\/g, "/");

  // Check for traversal patterns BEFORE path.resolve can hide them
  if (containsTraversal(decoded)) {
    throw new PathTraversalError(input);
  }

  // Strip leading slashes — paths must be vault-relative
  const stripped = decoded.replace(/^\/+/, "");

  return stripped;
}

function containsTraversal(p: string): boolean {
  const segments = p.split("/");
  return segments.some((seg) => seg === "..");
}
