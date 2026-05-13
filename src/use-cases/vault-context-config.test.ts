import { describe, it, expect, vi, afterEach } from "vitest";
import { parseVaultContextConfig, logDeprecationWarning } from "./vault-context-config.js";
import { InvalidConfigError } from "../domain/errors/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseVaultContextConfig", () => {
  it("defaults to auto mode when no env vars set", () => {
    const config = parseVaultContextConfig({});
    expect(config.mode).toBe("auto");
    expect(config.deprecatedVaultContext).toBeUndefined();
  });

  it("returns manual mode when VAULT_CONTEXT_MODE=manual", () => {
    const config = parseVaultContextConfig({ VAULT_CONTEXT_MODE: "manual" });
    expect(config.mode).toBe("manual");
  });

  it("returns auto mode when VAULT_CONTEXT_MODE=auto", () => {
    const config = parseVaultContextConfig({ VAULT_CONTEXT_MODE: "auto" });
    expect(config.mode).toBe("auto");
  });

  it("throws InvalidConfigError for invalid mode", () => {
    expect(() => parseVaultContextConfig({ VAULT_CONTEXT_MODE: "bogus" })).toThrow(InvalidConfigError);
  });

  it("error message contains valid options when mode is invalid", () => {
    try {
      parseVaultContextConfig({ VAULT_CONTEXT_MODE: "bogus" });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      const msg = (err as InvalidConfigError).message;
      expect(msg).toContain("auto");
      expect(msg).toContain("manual");
    }
  });

  it("stores VAULT_CONTEXT in deprecatedVaultContext when set", () => {
    const config = parseVaultContextConfig({ VAULT_CONTEXT: "my vault" });
    expect(config.deprecatedVaultContext).toBe("my vault");
    expect(config.mode).toBe("auto");
  });

  it("deprecatedVaultContext is undefined when VAULT_CONTEXT not set", () => {
    const config = parseVaultContextConfig({});
    expect(config.deprecatedVaultContext).toBeUndefined();
  });
});

describe("logDeprecationWarning", () => {
  it("logs to stderr when deprecatedVaultContext is set", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDeprecationWarning({ mode: "auto", deprecatedVaultContext: "my vault" });
    expect(spy).toHaveBeenCalledOnce();
    const msg: string = spy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("VAULT_CONTEXT");
    expect(msg).toContain("deprecated");
  });

  it("does nothing when deprecatedVaultContext is undefined", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDeprecationWarning({ mode: "auto", deprecatedVaultContext: undefined });
    expect(spy).not.toHaveBeenCalled();
  });
});
