import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand, runCommandCapture } from "./command";
import { buildOpencodeResumeCommand, runInitialOpencode } from "./opencode";
import { type ReviewRequest } from "./review-requests";

type ReviewSessionsOptions = {
  host: string;
  workspaceRoot: string;
  promptPath: string;
  dryRun: boolean;
  verbose: boolean;
};

export type ReviewSessionTarget = {
  request: ReviewRequest;
  cardId?: string;
};

const ensureBareRepo = async (
  barePath: string,
  cloneUrl: string,
  options: { dryRun: boolean; verbose: boolean },
) => {
  await mkdir(barePath, { recursive: true });
  const headPath = join(barePath, "HEAD");
  const hasHead = await access(headPath).then(
    () => true,
    () => false,
  );

  if (!hasHead) {
    await runCommand(
      "git",
      ["init", "--bare", "--initial-branch", "main", barePath],
      {
        dryRun: options.dryRun,
        verbose: options.verbose,
      },
    );
  }

  await runCommand("git", ["-C", barePath, "remote", "get-url", "origin"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  })
    .then(async () => {
      await runCommand(
        "git",
        ["-C", barePath, "remote", "set-url", "origin", cloneUrl],
        {
          dryRun: options.dryRun,
          verbose: options.verbose,
        },
      );
    })
    .catch(async () => {
      await runCommand(
        "git",
        ["-C", barePath, "remote", "add", "origin", cloneUrl],
        {
          dryRun: options.dryRun,
          verbose: options.verbose,
        },
      );
    });
};

const branchExists = async (options: {
  bareRepoPath: string;
  branchName: string;
  dryRun: boolean;
}): Promise<boolean> => {
  if (options.dryRun) {
    return false;
  }
  try {
    await runCommandCapture("git", [
      "-C",
      options.bareRepoPath,
      "show-ref",
      "--verify",
      `refs/heads/${options.branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
};

const ensureBranchWorktree = async (options: {
  bareRepoPath: string;
  worktreePath: string;
  baseRef: string;
  branchName: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  await mkdir(options.worktreePath, { recursive: true });
  const hasBranch = await branchExists({
    bareRepoPath: options.bareRepoPath,
    branchName: options.branchName,
    dryRun: options.dryRun,
  });
  const args = [
    "-C",
    options.bareRepoPath,
    "worktree",
    "add",
    "--force",
    options.worktreePath,
  ];
  if (hasBranch) {
    args.push(options.branchName);
  } else {
    args.push("-b", options.branchName, options.baseRef);
  }
  await runCommand("git", args, {
    dryRun: options.dryRun,
    verbose: options.verbose,
    allowFailure: true,
  });
  if (options.dryRun) {
    return;
  }
  const gitPath = join(options.worktreePath, ".git");
  const hasGit = await access(gitPath).then(
    () => true,
    () => false,
  );
  if (!hasGit) {
    throw new Error(`Worktree missing .git at ${options.worktreePath}`);
  }
};

export const runReviewSessionsTargets = async (
  targets: ReviewSessionTarget[],
  options: ReviewSessionsOptions,
  onSessionCreated?: (options: {
    target: ReviewSessionTarget;
    sessionId: string;
  }) => Promise<void>,
) => {
  if (targets.length === 0) {
    return;
  }

  const promptTemplate = await readFile(options.promptPath, "utf8");

  for (const target of targets) {
    const request = target.request;
    if (!request.repo) {
      console.log(`Skip review without repo slug: ${request.url}`);
      continue;
    }

    const [org, repo] = request.repo.split("/");
    const prNumber = request.url.split("/pull/")[1];
    const bareRepoPath = join(options.workspaceRoot, org, `${repo}.git`);
    const worktreePath = join(
      options.workspaceRoot,
      org,
      repo,
      `pr-${prNumber}`,
    );
    const baseBranch = request.baseRefName ?? "main";
    const baseWorktreePath = join(options.workspaceRoot, org, repo, baseBranch);
    const cloneUrl = `schibsted@${options.host}:${request.repo}.git`;

    await ensureBareRepo(bareRepoPath, cloneUrl, options);
    await runCommand(
      "git",
      ["-C", bareRepoPath, "fetch", "origin", "+refs/pull/*/head:refs/pull/*"],
      {
        dryRun: options.dryRun,
        verbose: options.verbose,
      },
    );
    await runCommand(
      "git",
      ["-C", bareRepoPath, "fetch", "origin", baseBranch],
      {
        dryRun: options.dryRun,
        verbose: options.verbose,
        allowFailure: true,
      },
    );

    await ensureBranchWorktree({
      bareRepoPath,
      worktreePath,
      baseRef: `refs/pull/${prNumber}`,
      branchName: `pr-${prNumber}`,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    await ensureBranchWorktree({
      bareRepoPath,
      worktreePath: baseWorktreePath,
      baseRef: `refs/remotes/origin/${baseBranch}`,
      branchName: baseBranch,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    const title = `Review ${request.repo}#${prNumber}`;
    const prompt = promptTemplate
      .replaceAll("[org/repo]", request.repo)
      .replaceAll("[pr-url]", request.url);
    const sessionId = await runInitialOpencode({
      title,
      prompt,
      cwd: worktreePath,
      verbose: options.verbose,
    });
    const opencodeCmd = buildOpencodeResumeCommand(sessionId);

    const aoeArgs = [
      "add",
      worktreePath,
      "--profile",
      "work",
      "--title",
      title,
      "--group",
      `reviews/${org}/${repo}`,
      "--cmd",
      opencodeCmd,
    ];

    await runCommand("aoe", aoeArgs, {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
    await runCommand("aoe", ["session", "start", "-p", "work", title], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    if (onSessionCreated) {
      await onSessionCreated({ target, sessionId });
    }
  }
};

export const runReviewSessions = async (
  requests: ReviewRequest[],
  options: ReviewSessionsOptions,
) => {
  await runReviewSessionsTargets(
    requests.map((request) => ({ request })),
    options,
  );
};
