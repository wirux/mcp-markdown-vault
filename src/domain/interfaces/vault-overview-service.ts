/** Summary of a single directory in the vault. */
export interface FolderSummary {
  path: string;
  fileCount: number;
  lastModified: string;
  children: FolderSummary[];
}

/** Overview of the vault structure. */
export interface VaultOverview {
  totalFiles: number;
  folders: FolderSummary[];
}

/** Port for the vault overview service. */
export interface IVaultOverviewService {
  getOverview(maxDepth?: number): Promise<VaultOverview>;
}
