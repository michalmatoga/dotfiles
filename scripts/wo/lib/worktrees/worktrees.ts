import { access, cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { runCommand, runCommandCapture } from "../command";

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

const resolveGitPath = async (repoPath: string, gitPath: string): Promise<string> => {
  const output = await runCommandCapture("git", ["-C", repoPath, "rev-parse", "--git-path", gitPath]);
  const resolved = output.trim();
  if (isAbsolute(resolved)) {
    return resolved;
  }
  return resolve(repoPath, resolved);
};

const resolveGitCryptStatePath = async (repoPath: string): Promise<string | null> => {
  const candidates = ["common/git-crypt", "git-crypt"];
  for (const candidate of candidates) {
    const gitCryptPath = await resolveGitPath(repoPath, candidate);
    const keyPath = join(gitCryptPath, "keys", "default");
    if (await pathExists(keyPath)) {
      return gitCryptPath;
    }
  }
  return null;
};

const ensureGitCryptStateInWorktree = async (sourcePath: string, worktreePath: string) => {
  const targetPath = await resolveGitPath(worktreePath, "git-crypt");
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true, force: true });
};

const addWorktreeNoCheckout = async (
  repoPath: string,
  worktreePath: string,
  branch: string,
  options: { verbose: boolean },
) => {
  try {
    await runCommand("gwq", ["add", branch, worktreePath], {
      cwd: repoPath,
      verbose: options.verbose,
    });
  } catch {
    await runCommand("git", ["-C", repoPath, "worktree", "add", "--no-checkout", worktreePath, branch], {
      verbose: options.verbose,
    });
  }
};

const ensureRepoCloned = async (parsed: ParsedUrl, options: { verbose: boolean }) => {
  const repoPath = resolveRepoPath(parsed);
  if (await pathExists(repoPath)) {
    return repoPath;
  }
  const sshUser = sshUserForHost(parsed.host);
  const sshUrl = `${sshUser}@${parsed.host}:${parsed.owner}/${parsed.repo}.git`;
  await runCommand("ghq", ["get", sshUrl], {
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

const slugify = (value: string) => {
  const lowered = value.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = cleaned.replace(/^-+/, "").replace(/-+$/, "");
  if (!trimmed) {
    return "work";
  }
  return trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed;
};

export const resolveWorkItemName = (options: { url: string; title: string }): string | null => {
  const parsed = parseGitHubUrl(options.url);
  if (!parsed) {
    return null;
  }
  const slug = slugify(options.title);
  const baseName = `${parsed.number}-${slug}`;
  if (parsed.kind === "pr") {
    return `pr-${baseName}`;
  }
  return baseName;
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

const ensureIssueBranch = async (repoPath: string, branch: string, options: { verbose: boolean }) => {
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
    { verbose: options.verbose },
  );
};

const ensurePrBranch = async (
  repoPath: string,
  prNumber: number,
  branch: string,
  options: { verbose: boolean },
) => {
  await runCommand("git", ["-C", repoPath, "fetch", "origin", `pull/${prNumber}/head`], {
    verbose: options.verbose,
  });
  await runCommand("git", ["-C", repoPath, "branch", "-f", branch, "FETCH_HEAD"], {
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
  title: string;
  path?: string | null;
  verbose: boolean;
}): Promise<WorktreeResult | null> => {
  const parsed = parseGitHubUrl(options.url);
  if (!parsed) {
    return null;
  }
  const repoPath = await ensureRepoCloned(parsed, options);
  const worktreeRoot = join(homedir(), "gwq", parsed.host, parsed.owner, parsed.repo);
  const resolvedName = resolveWorkItemName({ url: options.url, title: options.title });
  if (!resolvedName) {
    return null;
  }

  const branch = resolvedName;
  const worktreePath = options.path ?? join(worktreeRoot, sanitizeBranch(branch));
  if (await pathExists(worktreePath)) {
    return { branch, worktreePath };
  }

  if (parsed.kind === "issue") {
    await ensureIssueBranch(repoPath, branch, options);
  } else {
    await ensurePrBranch(repoPath, parsed.number, branch, options);
  }

  const gitCryptStatePath = await resolveGitCryptStatePath(repoPath);

  if (gitCryptStatePath) {
    await addWorktreeNoCheckout(repoPath, worktreePath, branch, options);
    await ensureGitCryptStateInWorktree(gitCryptStatePath, worktreePath);
    await runCommand("git", ["-C", worktreePath, "checkout", branch], {
      verbose: options.verbose,
    });
  } else {
    const args = ["add", branch];
    if (worktreePath) {
      args.push(worktreePath);
    }
    await runCommand("gwq", args, {
      cwd: repoPath,
      verbose: options.verbose,
    });
  }

  return { branch, worktreePath };
};

export const removeWorktreeForUrl = async (options: {
  url: string;
  title: string;
  path?: string | null;
  verbose: boolean;
}): Promise<WorktreeResult | "dirty" | null> => {
  const parsed = parseGitHubUrl(options.url);
  if (!parsed) {
    return null;
  }
  const repoPath = await ensureRepoCloned(parsed, options);
  const worktreeRoot = join(homedir(), "gwq", parsed.host, parsed.owner, parsed.repo);
  const resolvedName = resolveWorkItemName({ url: options.url, title: options.title });
  if (!resolvedName) {
    return null;
  }
  const branch = resolvedName;
  const worktreePath = options.path ?? join(worktreeRoot, sanitizeBranch(branch));

  if (!(await pathExists(worktreePath))) {
    return null;
  }

  if (await isDirty(worktreePath)) {
    return "dirty";
  }

  const args = ["remove", worktreePath, "-b"];

  await runCommand("gwq", args, {
    cwd: repoPath,
    verbose: options.verbose,
  });

  return { branch, worktreePath };
};
