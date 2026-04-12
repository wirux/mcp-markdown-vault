import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  IFileSystemAdapter,
  NoteStat,
} from "../domain/interfaces/index.js";
import {
  VaultNotFoundError,
  NoteNotFoundError,
  NoteAlreadyExistsError,
} from "../domain/errors/index.js";
import { SafePath } from "../domain/value-objects/index.js";

export class LocalFileSystemAdapter implements IFileSystemAdapter {
  private readonly vaultRoot: string;

  private constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
  }

  /**
   * Factory that validates the vault directory exists.
   * @throws VaultNotFoundError if path doesn't exist or is not a directory.
   */
  static async create(vaultRoot: string): Promise<LocalFileSystemAdapter> {
    const resolved = path.resolve(vaultRoot);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        throw new VaultNotFoundError(vaultRoot);
      }
    } catch (err) {
      if (err instanceof VaultNotFoundError) throw err;
      throw new VaultNotFoundError(vaultRoot);
    }
    return new LocalFileSystemAdapter(resolved);
  }

  async listNotes(directory?: string): Promise<string[]> {
    const target = directory
      ? SafePath.createDirectory(this.vaultRoot, directory)
      : SafePath.createDirectory(this.vaultRoot, "");

    try {
      await fs.access(target.absolute);
    } catch {
      return [];
    }

    const entries = await fs.readdir(target.absolute, {
      recursive: true,
      withFileTypes: true,
    });

    const mdFiles: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;

      // Build the vault-relative path
      // parentPath is the modern API; fall back to (entry as any).path for older Node
      const entryDir: string =
        entry.parentPath ??
        (entry as unknown as { path: string }).path;
      const fullPath = path.join(entryDir, entry.name);
      const relative = path.relative(this.vaultRoot, fullPath);
      mdFiles.push(relative);
    }

    return mdFiles.sort();
  }

  async readNote(notePath: string): Promise<string> {
    const safePath = SafePath.create(this.vaultRoot, notePath);
    try {
      return await fs.readFile(safePath.absolute, "utf-8");
    } catch {
      throw new NoteNotFoundError(notePath);
    }
  }

  async writeNote(
    notePath: string,
    content: string,
    overwrite?: boolean,
  ): Promise<void> {
    const safePath = SafePath.create(this.vaultRoot, notePath);

    // Check for existing file when overwrite is not enabled
    if (!overwrite) {
      try {
        await fs.access(safePath.absolute);
        throw new NoteAlreadyExistsError(notePath);
      } catch (err) {
        if (err instanceof NoteAlreadyExistsError) throw err;
        // File doesn't exist — proceed
      }
    }

    // Ensure parent directory exists
    const dir = path.dirname(safePath.absolute);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: write to temp file then rename
    const tmpName = `.${crypto.randomUUID()}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    try {
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, safePath.absolute);
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  async deleteNote(notePath: string): Promise<void> {
    const safePath = SafePath.create(this.vaultRoot, notePath);
    try {
      await fs.unlink(safePath.absolute);
    } catch {
      throw new NoteNotFoundError(notePath);
    }
  }

  async exists(notePath: string): Promise<boolean> {
    const safePath = SafePath.create(this.vaultRoot, notePath);
    try {
      await fs.access(safePath.absolute);
      return true;
    } catch {
      return false;
    }
  }

  async stat(notePath: string): Promise<NoteStat> {
    const safePath = SafePath.create(this.vaultRoot, notePath);
    try {
      const fileStat = await fs.stat(safePath.absolute);
      return {
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      };
    } catch {
      throw new NoteNotFoundError(notePath);
    }
  }
}
