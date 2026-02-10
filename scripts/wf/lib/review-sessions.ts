import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "./command";
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
    await runCommand("git", ["init", "--bare", barePath], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  }

  await runCommand("git", ["-C", barePath, "remote", "get-url", "origin"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  })
    .then(async () => {
      await runCommand("git", ["-C", barePath, "remote", "set-url", "origin", cloneUrl], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    })
    .catch(async () => {
      await runCommand("git", ["-C", barePath, "remote", "add", "origin", cloneUrl], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    });
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
    const worktreePath = join(options.workspaceRoot, org, repo, `pr-${prNumber}`);
    const baseBranch = request.baseRefName ?? "main";
    const baseWorktreePath = join(options.workspaceRoot, org, repo, baseBranch);
    const cloneUrl = `schibsted@${options.host}:${request.repo}.git`;

    await ensureBareRepo(bareRepoPath, cloneUrl, options);
    await runCommand("git", ["-C", bareRepoPath, "fetch", "origin", "+refs/pull/*/head:refs/pull/*"], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
    await runCommand(
      "git",
      ["-C", bareRepoPath, "fetch", "origin", baseBranch],
      {
        dryRun: options.dryRun,
        verbose: options.verbose,
        allowFailure: true,
      },
    );

    await mkdir(worktreePath, { recursive: true });
    await runCommand(
      "git",
      ["-C", bareRepoPath, "worktree", "add", "--force", worktreePath, `refs/pull/${prNumber}`],
      { dryRun: options.dryRun, verbose: options.verbose, allowFailure: true },
    );

    await mkdir(baseWorktreePath, { recursive: true });
    await runCommand(
      "git",
      [
        "-C",
        bareRepoPath,
        "worktree",
        "add",
        "--force",
        baseWorktreePath,
        `refs/remotes/origin/${baseBranch}`,
      ],
      { dryRun: options.dryRun, verbose: options.verbose, allowFailure: true },
    );

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
      `${options.host}-reviews`,
      "--title",
      title,
      "--group",
      `reviews/${org}/${repo}`,
      "--cmd",
      opencodeCmd,
    ];

    await runCommand("aoe", aoeArgs, { dryRun: options.dryRun, verbose: options.verbose });
    await runCommand(
      "aoe",
      ["session", "start", "-p", `${options.host}-reviews`, title],
      {
        dryRun: options.dryRun,
        verbose: options.verbose,
      },
    );

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
