import { InvalidConfigError } from "../domain/errors/index.js";

export type VaultContextMode = "auto" | "manual";

export interface VaultContextConfig {
  mode: VaultContextMode;
  deprecatedVaultContext: string | undefined;
}

const VALID_MODES: VaultContextMode[] = ["auto", "manual"];

export function parseVaultContextConfig(env: NodeJS.ProcessEnv): VaultContextConfig {
  const rawMode = env["VAULT_CONTEXT_MODE"];
  const mode: VaultContextMode = rawMode === undefined ? "auto" : validateMode(rawMode);
  const deprecatedVaultContext = env["VAULT_CONTEXT"] ?? undefined;
  return { mode, deprecatedVaultContext };
}

function validateMode(raw: string): VaultContextMode {
  if (raw === "auto" || raw === "manual") return raw;
  throw new InvalidConfigError(
    `VAULT_CONTEXT_MODE="${raw}" is not valid. Accepted values: ${VALID_MODES.join(", ")}`,
  );
}

export function logDeprecationWarning(config: VaultContextConfig): void {
  if (config.deprecatedVaultContext !== undefined) {
    console.error(
      `[mcp-markdown-vault] VAULT_CONTEXT is deprecated and will be ignored. ` +
        `Use VAULT_CONTEXT_MODE=auto|manual instead.`,
    );
  }
}
