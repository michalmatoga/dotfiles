import { loadEnvFile } from "../env";
import { resolveDotfilesPath } from "../paths";

type LoadEnvFn = (filePath: string, options?: { override?: boolean }) => Promise<void>;

export const loadJournalEnv = async (
  loadEnv: LoadEnvFn = loadEnvFile,
): Promise<"dotfiles-local" | "cwd-local" | "none"> => {
  const dotfilesEnvPath = resolveDotfilesPath(".env");
  const dotfilesLocalEnvPath = resolveDotfilesPath(".env.local");

  try {
    await loadEnv(dotfilesEnvPath);
    return "none";
  } catch {
    try {
      await loadEnv(dotfilesLocalEnvPath);
      return "dotfiles-local";
    } catch {
      try {
        await loadEnv(".env");
        return "none";
      } catch {
        try {
          await loadEnv(".env.local");
          return "cwd-local";
        } catch {
          return "none";
        }
      }
    }
  }
};
