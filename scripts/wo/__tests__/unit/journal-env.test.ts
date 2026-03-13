import { loadJournalEnv } from "../../lib/journal/env";

describe("journal env loading", () => {
  const originalDotfilesDir = process.env.DOTFILES_DIR;

  afterEach(() => {
    if (originalDotfilesDir === undefined) {
      delete process.env.DOTFILES_DIR;
    } else {
      process.env.DOTFILES_DIR = originalDotfilesDir;
    }
  });

  it("tries dotfiles paths before cwd paths", async () => {
    process.env.DOTFILES_DIR = "/tmp/dotfiles-test";
    const calls: string[] = [];
    const loadEnv = vi.fn(async (filePath: string) => {
      calls.push(filePath);
      throw new Error("missing");
    });

    const source = await loadJournalEnv(loadEnv);

    expect(source).toBe("none");
    expect(calls).toEqual([
      "/tmp/dotfiles-test/.env",
      "/tmp/dotfiles-test/.env.local",
      ".env",
      ".env.local",
    ]);
  });

  it("returns dotfiles-local when .env.local in dotfiles root is used", async () => {
    process.env.DOTFILES_DIR = "/tmp/dotfiles-test";
    const calls: string[] = [];
    const loadEnv = vi.fn(async (filePath: string) => {
      calls.push(filePath);
      if (filePath === "/tmp/dotfiles-test/.env.local") {
        return;
      }
      throw new Error("missing");
    });

    const source = await loadJournalEnv(loadEnv);

    expect(source).toBe("dotfiles-local");
    expect(calls).toEqual([
      "/tmp/dotfiles-test/.env",
      "/tmp/dotfiles-test/.env.local",
    ]);
  });

  it("returns cwd-local when cwd .env.local is used", async () => {
    process.env.DOTFILES_DIR = "/tmp/dotfiles-test";
    const calls: string[] = [];
    const loadEnv = vi.fn(async (filePath: string) => {
      calls.push(filePath);
      if (filePath === ".env.local") {
        return;
      }
      throw new Error("missing");
    });

    const source = await loadJournalEnv(loadEnv);

    expect(source).toBe("cwd-local");
    expect(calls).toEqual([
      "/tmp/dotfiles-test/.env",
      "/tmp/dotfiles-test/.env.local",
      ".env",
      ".env.local",
    ]);
  });
});
