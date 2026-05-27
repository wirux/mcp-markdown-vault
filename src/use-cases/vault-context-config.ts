import { InvalidConfigError } from "../domain/errors/index.js";

export type VaultContextMode = "manual" | "assisted";

export interface VaultContextConfig {
  mode: VaultContextMode;
  deprecatedVaultContext: string | undefined;
}

const VALID_MODES: VaultContextMode[] = ["manual", "assisted"];

export function parseVaultContextConfig(env: NodeJS.ProcessEnv): VaultContextConfig {
  const rawMode = env["VAULT_CONTEXT_MODE"];
  const mode: VaultContextMode = rawMode === undefined ? "assisted" : validateMode(rawMode);
  const deprecatedVaultContext = env["VAULT_CONTEXT"] ?? undefined;
  return { mode, deprecatedVaultContext };
}

function validateMode(raw: string): VaultContextMode {
  if (raw === "manual") return "manual";
  if (raw === "assisted") return "assisted";
  if (raw === "auto") {
    console.warn(
      `[mcp-markdown-vault] VAULT_CONTEXT_MODE="auto" is deprecated. ` +
        `Mapping to "assisted" mode. Please update your configuration to use VAULT_CONTEXT_MODE=assisted.`,
    );
    return "assisted";
  }
  throw new InvalidConfigError(
    `VAULT_CONTEXT_MODE="${raw}" is not valid. Accepted values: ${VALID_MODES.join(", ")}`,
  );
}

export function logDeprecationWarning(config: VaultContextConfig): void {
  if (config.deprecatedVaultContext !== undefined) {
    console.error(
      `[mcp-markdown-vault] VAULT_CONTEXT is deprecated and will be ignored. ` +
        `Use VAULT_CONTEXT_MODE=manual|assisted instead.`,
    );
  }
}
