import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { runCommand, runCommandCapture } from "../command";
import { ghJson } from "../gh/gh";

type ParsedUrl = {
  host: string;
  owner: string;
  repo: string;
  number: number;
  kind: "issue" | "pr";
};

type WorktreeResult = {
  branch: string;
  worktreePath: string;
};

const sshUserForHost = (host: string) => (host === "schibsted.ghe.com" ? "schibsted" : "git");

const parseGitHubUrl = (url: string): ParsedUrl | null => {
  const match = url.match(
    /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/,
  );
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    kind: match[4] === "pull" ? "pr" : "issue",
    number: Number(match[5]),
  };
};

const sanitizeBranch = (branch: string) => branch.replace(/\//g, "-");

const resolveRepoPath = (parsed: ParsedUrl) =>
  join(homedir(), "ghq", parsed.host, parsed.owner, parsed.repo);

const resolveWorktreePath = (parsed: ParsedUrl, segment: string) =>
  join(homedir(), "gwq", parsed.host, parsed.owner, parsed.repo, sanitizeBranch(segment));

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const ensureRepoCloned = async (parsed: ParsedUrl, options: { dryRun: boolean; verbose: boolean }) => {
  const repoPath = resolveRepoPath(parsed);
  if (await pathExists(repoPath)) {
    return repoPath;
  }
  const sshUser = sshUserForHost(parsed.host);
  const sshUrl = `${sshUser}@${parsed.host}:${parsed.owner}/${parsed.repo}.git`;
  await runCommand("ghq", ["get", sshUrl], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
  return repoPath;
};

const branchExists = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    await runCommandCapture("git", ["-C", repoPath, "show-ref", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
};

const resolveDefaultBranch = async (repoPath: string): Promise<string> => {
  try {
    const output = await runCommandCapture("git", [
      "-C",
      repoPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    const trimmed = output.trim();
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || "main";
  } catch {
    return "main";
  }
};

const ensureIssueBranch = async (repoPath: string, branch: string, options: { dryRun: boolean; verbose: boolean }) => {
  if (!(await pathExists(repoPath))) {
    return;
  }
  if (await branchExists(repoPath, branch)) {
    return;
  }
  const defaultBranch = await resolveDefaultBranch(repoPath);
  await runCommand(
    "git",
    ["-C", repoPath, "branch", branch, `origin/${defaultBranch}`],
    { dryRun: options.dryRun, verbose: options.verbose },
  );
};

const resolvePrBranch = async (url: string, host: string): Promise<string | null> => {
  try {
    const response = await ghJson<{ headRefName: string }>(
      ["pr", "view", url, "--json", "headRefName"],
      { host },
    );
    return response.headRefName || null;
  } catch {
    return null;
  }
};

const ensurePrBranch = async (
  repoPath: string,
  prNumber: number,
  branch: string,
  options: { dryRun: boolean; verbose: boolean },
) => {
  await runCommand("git", ["-C", repoPath, "fetch", "origin", `pull/${prNumber}/head`], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
  await runCommand("git", ["-C", repoPath, "branch", "-f", branch, "FETCH_HEAD"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
};

const isDirty = async (worktreePath: string): Promise<boolean> => {
  try {
    const output = await runCommandCapture("git", ["-C", worktreePath, "status", "--porcelain"]);
    return output.trim().length > 0;
  } catch {
    return false;
  }
};

export const buildWorktreePath = (url: string, segment: string): string | null => {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return null;
  }
  return resolveWorktreePath(parsed, segment);
};

export const ensureWorktreeForUrl = async (options: {
  url: string;
  path?: string | null;
  dryRun: boolean;
  verbose: boolean;
}): Promise<WorktreeResult | null> => {
  const parsed = parseGitHubUrl(options.url);
  if (!parsed) {
    return null;
  }
  const repoPath = await ensureRepoCloned(parsed, options);
  const branch =
    parsed.kind === "issue"
      ? `wo/issue-${parsed.number}`
      : (await resolvePrBranch(options.url, parsed.host)) ?? `pr-${parsed.number}`;

  if (parsed.kind === "issue") {
    await ensureIssueBranch(repoPath, branch, options);
  } else {
    await ensurePrBranch(repoPath, parsed.number, branch, options);
  }

  const worktreePath = options.path ?? resolveWorktreePath(parsed, branch);
  if (await pathExists(worktreePath)) {
    return { branch, worktreePath };
  }

  const args = ["add", branch];
  if (worktreePath) {
    args.push(worktreePath);
  }
  await runCommand("gwq", args, {
    cwd: repoPath,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });

  return { branch, worktreePath };
};

export const removeWorktreeForUrl = async (options: {
  url: string;
  path?: string | null;
  dryRun: boolean;
  verbose: boolean;
}): Promise<WorktreeResult | "dirty" | null> => {
  const parsed = parseGitHubUrl(options.url);
  if (!parsed) {
    return null;
  }
  const repoPath = await ensureRepoCloned(parsed, options);
  const branch =
    parsed.kind === "issue"
      ? `wo/issue-${parsed.number}`
      : (await resolvePrBranch(options.url, parsed.host)) ?? `pr-${parsed.number}`;
  const worktreePath = options.path ?? resolveWorktreePath(parsed, branch);

  if (!(await pathExists(worktreePath))) {
    return null;
  }

  if (await isDirty(worktreePath)) {
    return "dirty";
  }

  const args = ["remove", worktreePath];
  if (branch.startsWith("wo/issue-")) {
    args.splice(1, 0, "-b");
  }

  await runCommand("gwq", args, {
    cwd: repoPath,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });

  return { branch, worktreePath };
};
