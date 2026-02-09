import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "./lib/command";
import { fetchReviewRequests } from "./lib/review-requests";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";

const workspaceRoot = join(process.env.HOME ?? "", "g", ghHost);
const promptPath = "scripts/wf/prompts/review.md";

const parseArgs = (args: string[]) => {
  const flags = new Set(args);
  return {
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
};

const ensureBareRepo = async (
  barePath: string,
  cloneUrl: string,
  options: { dryRun: boolean; verbose: boolean },
) => {
  await mkdir(barePath, { recursive: true });
  const hasGitDir = await runCommand("git", ["-C", barePath, "rev-parse", "--git-dir"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  }).then(
    () => true,
    () => false,
  );

  if (!hasGitDir && !options.dryRun) {
    await runCommand("git", ["-C", barePath, "init", "--bare"], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  }

  await runCommand("git", ["-C", barePath, "remote", "get-url", "origin"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  }).catch(async () => {
    await runCommand("git", ["-C", barePath, "remote", "add", "origin", cloneUrl], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  });
};

const main = async () => {
  const { dryRun, verbose } = parseArgs(process.argv.slice(2));
  const reviewRequests = await fetchReviewRequests({ host: ghHost, user: ghUser });

  if (verbose) {
    console.log(`Review requests: ${reviewRequests.length}`);
  }

  for (const request of reviewRequests) {
    if (!request.repo) {
      console.log(`Skip review without repo slug: ${request.url}`);
      continue;
    }

    const [org, repo] = request.repo.split("/");
    const prNumber = request.url.split("/pull/")[1];
    const bareRepoPath = join(workspaceRoot, org, `${repo}.git`);
    const worktreePath = join(workspaceRoot, org, repo, `pr-${prNumber}`);
    const cloneUrl = `git@${ghHost}:${request.repo}.git`;

    await ensureBareRepo(bareRepoPath, cloneUrl, { dryRun, verbose });
    await runCommand("git", ["-C", bareRepoPath, "fetch", "origin", "+refs/pull/*/head:refs/pull/*"], {
      dryRun,
      verbose,
    });

    await mkdir(worktreePath, { recursive: true });
    await runCommand(
      "git",
      ["-C", bareRepoPath, "worktree", "add", "--force", worktreePath, `refs/pull/${prNumber}/head`],
      { dryRun, verbose },
    );

    const title = `Review ${request.repo}#${prNumber}`;
    const promptTemplate = await readFile(promptPath, "utf8");
    const prompt = promptTemplate
      .replaceAll("[org/repo]", request.repo)
      .replaceAll("[pr-url]", request.url);
    const opencodeCmd = `opencode run --format json --title "${title}" --share "${prompt.replaceAll("\"", "\\\"")}"`;

    const aoeArgs = [
      "add",
      worktreePath,
      "--title",
      title,
      "--group",
      `reviews/${ghHost}/${request.repo}`,
      "--cmd",
      opencodeCmd,
      "--launch",
    ];

    await runCommand("aoe", aoeArgs, { dryRun, verbose });
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
