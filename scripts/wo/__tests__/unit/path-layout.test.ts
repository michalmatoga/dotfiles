import { homedir } from "node:os";
import { join } from "node:path";

import { classifyGhqEntry } from "../../bin/tmux-wo-sessionizer";
import { toRepoLabel } from "../../lib/metrics/aw-time";
import { pathToLabel } from "../../lib/sessions/journal";
import {
  buildWorktreePath,
  buildWorktreePathForRepo,
  resolveRepoInfoFromWorktreePath,
} from "../../lib/worktrees/worktrees";

describe("single-root worktree paths", () => {
  const home = homedir();
  const repoPath = join(home, "ghq", "github.com", "acme", "widget");
  const worktreePath = join(home, "ghq", "github.com", "acme", "widget=feature-branch");

  it("builds worktree paths under ghq", () => {
    expect(buildWorktreePath("https://github.com/acme/widget/issues/42", "feature/branch")).toBe(worktreePath);
    expect(buildWorktreePathForRepo(repoPath, "feature/branch")).toBe(worktreePath);
  });

  it("parses repo info from repo=branch worktree paths", () => {
    expect(resolveRepoInfoFromWorktreePath(worktreePath)).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widget",
      repoPath,
      branch: "feature-branch",
    });
  });

  it("classifies ghq entries as repos or worktrees", () => {
    const worktreeEntry = classifyGhqEntry({
      entryPath: worktreePath,
      ghqRoot: join(home, "ghq"),
      worktreeUrlMap: new Map([[worktreePath, "https://github.com/acme/widget/issues/42"]]),
    });
    const repoEntry = classifyGhqEntry({
      entryPath: repoPath,
      ghqRoot: join(home, "ghq"),
      existsPath: (path) => path === join(repoPath, ".git/refs/heads/main"),
    });

    expect(worktreeEntry).toMatchObject({
      kind: "worktree",
      host: "github.com",
      owner: "acme",
      repo: "widget",
      leaf: "feature-branch",
      url: "https://github.com/acme/widget/issues/42",
    });
    expect(repoEntry).toMatchObject({
      kind: "repo",
      host: "github.com",
      owner: "acme",
      repo: "widget",
      leaf: "main",
    });
    expect(
      classifyGhqEntry({
        entryPath: repoPath,
        ghqRoot: join(home, "ghq"),
        includeRepos: false,
      }),
    ).toBeNull();
  });

  it("keeps repo labels stable for repo and worktree paths", () => {
    expect(toRepoLabel(repoPath)).toBe("github.com/acme/widget");
    expect(toRepoLabel(worktreePath)).toBe("github.com/acme/widget");
    expect(pathToLabel(repoPath)).toBe("acme/widget");
    expect(pathToLabel(worktreePath)).toBe("acme/widget");
  });
});
