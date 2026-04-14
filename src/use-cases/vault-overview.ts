import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type {
  IVaultOverviewService,
  VaultOverview,
  FolderSummary,
} from "../domain/interfaces/vault-overview-service.js";

// Directory patterns to skip
const HIDDEN_SEGMENT_RE = /^\./;
const IGNORED_SEGMENTS = new Set(["node_modules"]);

function isHiddenPath(filePath: string): boolean {
  const segments = filePath.split("/");
  return segments.some(
    (seg) => HIDDEN_SEGMENT_RE.test(seg) || IGNORED_SEGMENTS.has(seg),
  );
}

/**
 * Service that builds an overview of the vault structure.
 * Uses IFileSystemAdapter to read file lists and metadata.
 */
export class VaultOverviewService implements IVaultOverviewService {
  constructor(private readonly fsAdapter: IFileSystemAdapter) {}

  async getOverview(maxDepth?: number): Promise<VaultOverview> {
    const depth = maxDepth ?? 3;
    const allFiles = await this.fsAdapter.listNotes();

    // Filter out files from hidden directories
    const files = allFiles.filter((f) => !isHiddenPath(f));

    if (files.length === 0) {
      return { totalFiles: 0, folders: [] };
    }

    // Fetch modification dates for all files
    const statsMap = new Map<string, string>();
    await Promise.all(
      files.map(async (f) => {
        const stat = await this.fsAdapter.stat(f);
        statsMap.set(f, stat.modifiedAt);
      }),
    );

    // Group files by parent directory
    const dirFiles = new Map<string, string[]>();
    for (const file of files) {
      const parts = file.split("/");
      const dir = parts.length === 1 ? "." : parts.slice(0, -1).join("/");
      if (!dirFiles.has(dir)) dirFiles.set(dir, []);
      dirFiles.get(dir)!.push(file);
    }

    // Collect all unique directory paths (within depth limit)
    const allDirs = new Set<string>();
    for (const file of files) {
      const parts = file.split("/");
      if (parts.length === 1) {
        allDirs.add(".");
      }
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/");
        const dirDepth = i;
        if (dirDepth <= depth) {
          allDirs.add(dirPath);
        }
      }
    }

    // Build FolderSummary objects
    const folderMap = new Map<string, FolderSummary>();
    for (const dir of allDirs) {
      const directFiles = dirFiles.get(dir) ?? [];
      const lastModified =
        directFiles.length > 0
          ? directFiles
              .map((f) => statsMap.get(f)!)
              .sort()
              .at(-1)!
          : "";

      folderMap.set(dir, {
        path: dir,
        fileCount: directFiles.length,
        lastModified,
        children: [],
      });
    }

    // Build tree — assign children to parents
    const roots: FolderSummary[] = [];
    for (const [dirPath, summary] of folderMap) {
      if (dirPath === ".") {
        roots.push(summary);
        continue;
      }
      const parentSegments = dirPath.split("/");
      parentSegments.pop();
      const parentPath =
        parentSegments.length === 0 ? "." : parentSegments.join("/");
      const parent = folderMap.get(parentPath);
      if (parent) {
        parent.children.push(summary);
      } else {
        roots.push(summary);
      }
    }

    // Sortuj katalogi alfabetycznie (rekurencyjnie)
    sortFolders(roots);

    return { totalFiles: files.length, folders: roots };
  }
}

function sortFolders(folders: FolderSummary[]): void {
  folders.sort((a, b) => a.path.localeCompare(b.path));
  for (const f of folders) {
    sortFolders(f.children);
  }
}
