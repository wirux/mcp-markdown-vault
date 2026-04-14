/** Podsumowanie pojedynczego katalogu w vault. */
export interface FolderSummary {
  path: string;
  fileCount: number;
  lastModified: string;
  children: FolderSummary[];
}

/** Przegląd struktury vault. */
export interface VaultOverview {
  totalFiles: number;
  folders: FolderSummary[];
}

/** Port dla usługi przeglądu vault. */
export interface IVaultOverviewService {
  getOverview(maxDepth?: number): Promise<VaultOverview>;
}
