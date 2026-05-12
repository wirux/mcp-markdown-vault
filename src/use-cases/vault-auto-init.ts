import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { NoteAlreadyExistsError } from "../domain/errors/index.js";
import { generateContractTemplate } from "./contract-template.js";
import { generateOverviewStub } from "./overview-template.js";

export interface AutoInitResult {
  contractCreated: boolean;
  overviewCreated: boolean;
  warnings: string[];
}

export class VaultAutoInitService {
  private readonly fsAdapter: IFileSystemAdapter;
  private readonly vaultContext: string;

  constructor(deps: { fsAdapter: IFileSystemAdapter; vaultContext: string }) {
    this.fsAdapter = deps.fsAdapter;
    this.vaultContext = deps.vaultContext;
  }

  async initialize(): Promise<AutoInitResult> {
    const warnings: string[] = [];
    let contractCreated = false;
    let overviewCreated = false;

    contractCreated = await this.createIfMissing(
      "meta/contract.md",
      () => generateContractTemplate(this.vaultContext, new Date().toISOString()),
    );

    if (contractCreated) {
      const existingNotes = await this.fsAdapter.listNotes();
      const hasOtherNotes = existingNotes.some((p) => p !== "meta/contract.md" && p !== "meta/overview.md");
      if (hasOtherNotes) {
        warnings.push(
          "meta/contract.md auto-created in non-empty vault — review and customize for accurate scope and conventions",
        );
      }
    }

    overviewCreated = await this.createIfMissing(
      "meta/overview.md",
      () => generateOverviewStub(new Date().toISOString()),
    );

    return { contractCreated, overviewCreated, warnings };
  }

  private async createIfMissing(path: string, contentFn: () => string): Promise<boolean> {
    try {
      const exists = await this.fsAdapter.exists(path);
      if (exists) return false;
      await this.fsAdapter.writeNote(path, contentFn());
      return true;
    } catch (err) {
      if (err instanceof NoteAlreadyExistsError) return false;
      // Write failure (e.g. read-only filesystem) — degrade gracefully
      console.error(`[vault-auto-init] Failed to create ${path}:`, err);
      return false;
    }
  }
}
