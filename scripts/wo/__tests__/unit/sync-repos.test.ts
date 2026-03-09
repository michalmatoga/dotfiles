import { join } from "node:path";

import { classifyRepoRemovals, parseWorktreeList } from "../../../sync-repos.mjs";

describe("sync-repos cleanup", () => {
  const homeDir = "/home/test";
  const ownerDir = join(homeDir, "ghq", "github.com", "acme");
  const repoPath = join(ownerDir, "widget");
  const worktreePath = join(ownerDir, "widget=feature-branch");

  it("parses git worktree porcelain output", () => {
    const raw = [
      `worktree ${repoPath}`,
      "HEAD abcdef0",
      "branch refs/heads/main",
      "",
      `worktree ${worktreePath}`,
      "HEAD 1234567",
      "branch refs/heads/feature-branch",
    ].join("\n");

    expect(parseWorktreeList(raw)).toEqual([repoPath, worktreePath]);
  });

  it("never deletes worktree-shaped ghq entries", () => {
    const result = classifyRepoRemovals(["github.com/acme/widget=feature-branch"], {
      homeDir,
      existsSyncImpl: () => true,
      readdirSyncImpl: () => [],
      listWorktreePathsImpl: () => [repoPath],
    });

    expect(result.removePaths).toEqual([]);
    expect(result.skippedRepos).toEqual([
      { repo: "github.com/acme/widget=feature-branch", reason: "worktree-path" },
    ]);
  });

  it("skips base repos that still have linked worktrees", () => {
    const result = classifyRepoRemovals(["github.com/acme/widget"], {
      homeDir,
      existsSyncImpl: () => true,
      readdirSyncImpl: () => ["widget", "widget=feature-branch"],
      listWorktreePathsImpl: () => [repoPath, worktreePath],
    });

    expect(result.removePaths).toEqual([]);
    expect(result.skippedRepos).toEqual([
      { repo: "github.com/acme/widget", reason: "linked-worktrees" },
    ]);
  });

  it("allows deleting base repos without linked worktrees", () => {
    const result = classifyRepoRemovals(["github.com/acme/widget"], {
      homeDir,
      existsSyncImpl: () => true,
      readdirSyncImpl: () => ["widget"],
      listWorktreePathsImpl: () => [repoPath],
    });

    expect(result.removePaths).toEqual([repoPath]);
    expect(result.skippedRepos).toEqual([]);
  });

  it("handles nested namespaces without truncating the repo path", () => {
    const nestedRepo = "gitlab.com/acme/platform/widget";
    const nestedParentDir = join(homeDir, "ghq", "gitlab.com", "acme", "platform");
    const nestedRepoPath = join(nestedParentDir, "widget");
    const nestedWorktreePath = join(nestedParentDir, "widget=feature-branch");

    const result = classifyRepoRemovals([nestedRepo], {
      homeDir,
      existsSyncImpl: (path) => path === nestedParentDir,
      readdirSyncImpl: () => ["widget", "widget=feature-branch"],
      listWorktreePathsImpl: (path) => {
        expect(path).toBe(nestedRepoPath);
        return [nestedRepoPath, nestedWorktreePath];
      },
    });

    expect(result.removePaths).toEqual([]);
    expect(result.skippedRepos).toEqual([
      { repo: nestedRepo, reason: "linked-worktrees" },
    ]);
  });
});
