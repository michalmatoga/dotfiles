import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "./command";
import { type ReviewRequest } from "./review-requests";

type ReviewSessionsOptions = {
  host: string;
  workspaceRoot: string;
  promptPath: string;
  dryRun: boolean;
  verbose: boolean;
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

const buildOpencodeCommand = (title: string, promptFile: string) => {
  return `bash -lc 'opencode run --format json --title "${title}" --share "$(cat "${promptFile}")"'`;
};

export const runReviewSessions = async (
  requests: ReviewRequest[],
  options: ReviewSessionsOptions,
) => {
  if (requests.length === 0) {
    return;
  }

  const promptTemplate = await readFile(options.promptPath, "utf8");

  for (const request of requests) {
    if (!request.repo) {
      console.log(`Skip review without repo slug: ${request.url}`);
      continue;
    }

    const [org, repo] = request.repo.split("/");
    const prNumber = request.url.split("/pull/")[1];
    const bareRepoPath = join(options.workspaceRoot, org, `${repo}.git`);
    const worktreePath = join(options.workspaceRoot, org, repo, `pr-${prNumber}`);
    const cloneUrl = `schibsted@${options.host}:${request.repo}.git`;

    await ensureBareRepo(bareRepoPath, cloneUrl, options);
    await runCommand("git", ["-C", bareRepoPath, "fetch", "origin", "+refs/pull/*/head:refs/pull/*"], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    await mkdir(worktreePath, { recursive: true });
    await runCommand(
      "git",
      ["-C", bareRepoPath, "worktree", "add", "--force", worktreePath, `refs/pull/${prNumber}`],
      { dryRun: options.dryRun, verbose: options.verbose },
    );

    const title = `Review ${request.repo}#${prNumber}`;
    const prompt = promptTemplate
      .replaceAll("[org/repo]", request.repo)
      .replaceAll("[pr-url]", request.url);
    const promptFile = join(worktreePath, ".wf-review-prompt.txt");
    if (!options.dryRun) {
      await writeFile(promptFile, prompt, "utf8");
    }
    const opencodeCmd = buildOpencodeCommand(title, promptFile);

    const aoeArgs = [
      "add",
      worktreePath,
      "--title",
      title,
      "--group",
      `reviews/${options.host}/${request.repo}`,
      "--cmd",
      opencodeCmd,
      "--launch",
    ];

    await runCommand("aoe", aoeArgs, { dryRun: options.dryRun, verbose: options.verbose });
  }
};
