import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const readEnv = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
};

export const resolveDotfilesDir = (): string => {
  const fromEnv = readEnv("DOTFILES_DIR");
  if (fromEnv) {
    return fromEnv;
  }

  if (existsSync(join(moduleRepoRoot, ".git"))) {
    return moduleRepoRoot;
  }

  return process.cwd();
};

export const resolveWoStateDir = (): string => {
  const override = readEnv("WO_METRICS_STATE_DIR");
  if (override) {
    return override;
  }
  return join(resolveDotfilesDir(), "scripts/wo/state");
};

export const resolveDotfilesPath = (...segments: string[]): string =>
  join(resolveDotfilesDir(), ...segments);
