import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCommandMock, runCommandCaptureMock, state } = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
  runCommandCaptureMock: vi.fn(),
  state: { mockHome: "" },
}));

let createPackageJsonOnWorktreeCreate = true;
let packageJsonContent = "{\"name\":\"tmp\"}\n";
let createPnpmLockOnWorktreeCreate = false;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => state.mockHome,
  };
});

vi.mock("../../lib/command", () => ({
  runCommand: runCommandMock,
  runCommandCapture: runCommandCaptureMock,
}));

import { ensureWorktreeForRepo } from "../../lib/worktrees/worktrees";

describe("worktree npm bootstrap", () => {
  beforeEach(async () => {
    runCommandMock.mockReset();
    runCommandCaptureMock.mockReset();
    createPackageJsonOnWorktreeCreate = true;
    packageJsonContent = "{\"name\":\"tmp\"}\n";
    createPnpmLockOnWorktreeCreate = false;

    state.mockHome = await mkdtemp(join(tmpdir(), "wo-home-"));
    const repoPath = join(state.mockHome, "ghq", "github.com", "acme", "widget");
    await mkdir(repoPath, { recursive: true });

    runCommandCaptureMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes("show-ref")) {
        throw new Error("branch missing");
      }
      if (args.includes("symbolic-ref")) {
        return "refs/remotes/origin/main\n";
      }
      if (args.includes("rev-parse")) {
        const gitPath = args[args.length - 1] ?? "git-crypt";
        return `.git/${gitPath}\n`;
      }
      return "";
    });

    runCommandMock.mockImplementation(async (command: string, args: string[], options?: { cwd?: string }) => {
      if (command !== "gwq" || args[0] !== "add") {
        return;
      }
      const worktreePath = args[2];
      if (!worktreePath) {
        throw new Error("expected worktree path");
      }
      await mkdir(worktreePath, { recursive: true });
      if (createPackageJsonOnWorktreeCreate) {
        await writeFile(join(worktreePath, "package.json"), packageJsonContent, "utf8");
      }
      if (createPnpmLockOnWorktreeCreate) {
        await writeFile(join(worktreePath, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      }
      if (options?.cwd) {
        await mkdir(options.cwd, { recursive: true });
      }
    });
  });

  it("runs npm install for newly created JS worktrees", async () => {
    const repoPath = join(state.mockHome, "ghq", "github.com", "acme", "widget");
    const result = await ensureWorktreeForRepo({
      repoPath,
      segment: "123-session-hardening",
      verbose: false,
    });

    expect(result).not.toBeNull();
    const npmCall = runCommandMock.mock.calls.find(
      ([command, args]) => command === "npm" && Array.isArray(args) && args[0] === "install",
    );
    expect(npmCall).toBeDefined();
  });

  it("skips npm install when package.json is missing", async () => {
    createPackageJsonOnWorktreeCreate = false;
    const repoPath = join(state.mockHome, "ghq", "github.com", "acme", "widget");

    await ensureWorktreeForRepo({
      repoPath,
      segment: "124-no-node",
      verbose: false,
    });

    const npmCall = runCommandMock.mock.calls.find(([command]) => command === "npm");
    expect(npmCall).toBeUndefined();
  });

  it("prefers pnpm when pnpm lockfile is present", async () => {
    createPnpmLockOnWorktreeCreate = true;
    const repoPath = join(state.mockHome, "ghq", "github.com", "acme", "widget");

    await ensureWorktreeForRepo({
      repoPath,
      segment: "125-pnpm",
      verbose: false,
    });

    const pnpmCall = runCommandMock.mock.calls.find(
      ([command, args]) => command === "pnpm" && Array.isArray(args) && args[0] === "install",
    );
    expect(pnpmCall).toBeDefined();
  });

  it("prefers packageManager field from package.json", async () => {
    packageJsonContent = "{\"name\":\"tmp\",\"packageManager\":\"pnpm@9.0.0\"}\n";
    const repoPath = join(state.mockHome, "ghq", "github.com", "acme", "widget");

    await ensureWorktreeForRepo({
      repoPath,
      segment: "126-package-manager-hint",
      verbose: false,
    });

    const pnpmCall = runCommandMock.mock.calls.find(
      ([command, args]) => command === "pnpm" && Array.isArray(args) && args[0] === "install",
    );
    expect(pnpmCall).toBeDefined();
  });
});
