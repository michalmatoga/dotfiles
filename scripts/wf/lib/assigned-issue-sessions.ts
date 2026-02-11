import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand, runCommandCapture } from "./command";
import { loadEnvFile, requireEnv } from "./env";
import { buildOpencodeResumeCommand, runInitialOpencode } from "./opencode";
import { trelloRequest, type TrelloCard, type TrelloComment } from "./trello";

export type AssignedIssueSessionTarget = {
  cardId: string;
  issueUrl: string;
  repo: string;
  issueNumber: string;
};

const trelloBoardId = "HZ7hcWZy";
const trelloReadyListId = "6689284f81d51c086a80879c";
const trelloDoingListId = "668928577acb6ab04b723321";
const trelloWorkLabelId = "6694db7c23e5de7bec1b7489";
const trelloEnvFile = ".env";
const issueUrlRegex = /https:\/\/schibsted\.ghe\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/;
const sessionMarkerRegex = /\bopencode\s+-s\s+\S+/i;

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels,idList",
  });
};

const fetchCardComments = async (cardId: string): Promise<TrelloComment[]> => {
  return trelloRequest<TrelloComment[]>(`cards/${cardId}/actions`, {
    filter: "commentCard",
    fields: "data",
  });
};

const hasSessionComment = async (cardId: string): Promise<boolean> => {
  const comments = await fetchCardComments(cardId);
  return comments.some((comment) => sessionMarkerRegex.test(comment.data.text));
};

export const addSessionComment = async (options: {
  cardId: string;
  sessionId: string;
  dryRun: boolean;
}) => {
  const comment = `opencode -s ${options.sessionId}`;
  if (options.dryRun) {
    console.log(`[dry-run] add session comment: ${comment}`);
    return;
  }
  await trelloRequest(
    `cards/${options.cardId}/actions/comments`,
    { text: comment },
    { method: "POST" },
  );
  console.log(`Added session comment: ${comment}`);
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
    await runCommand("git", ["init", "--bare", "--initial-branch", "main", barePath], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
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

const ensureWorktree = async (options: {
  bareRepoPath: string;
  worktreePath: string;
  ref: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  await mkdir(options.worktreePath, { recursive: true });
  await runCommand(
    "git",
    [
      "-C",
      options.bareRepoPath,
      "worktree",
      "add",
      "--force",
      options.worktreePath,
      options.ref,
    ],
    {
      dryRun: options.dryRun,
      verbose: options.verbose,
      allowFailure: true,
    },
  );
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

const resolveBaseRef = async (options: {
  bareRepoPath: string;
  dryRun: boolean;
}): Promise<string> => {
  const candidates = ["main", "master"];
  for (const candidate of candidates) {
    if (options.dryRun) {
      return `refs/remotes/origin/${candidate}`;
    }
    try {
      await runCommandCapture("git", [
        "-C",
        options.bareRepoPath,
        "show-ref",
        "--verify",
        `refs/remotes/origin/${candidate}`,
      ]);
      return `refs/remotes/origin/${candidate}`;
    } catch {
      // try next candidate
    }
  }
  return "refs/remotes/origin/main";
};

const extractIssueReference = (text: string) => {
  const match = text.match(issueUrlRegex);
  if (!match) {
    return null;
  }
  return { repo: match[1], issueNumber: match[2], url: match[0] };
};

export const fetchAssignedIssueSessionTargets = async (options: {
  verbose: boolean;
}): Promise<AssignedIssueSessionTarget[]> => {
  await loadEnvFile(trelloEnvFile);
  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const openCards = await fetchOpenCards();
  const targets: AssignedIssueSessionTarget[] = [];

  const eligibleListIds = new Set([trelloReadyListId, trelloDoingListId]);

  for (const card of openCards) {
    if (!card.idList || !eligibleListIds.has(card.idList)) {
      continue;
    }
    if (!card.idLabels.includes(trelloWorkLabelId)) {
      continue;
    }
    const issueRef = extractIssueReference(card.desc);
    if (!issueRef) {
      if (options.verbose) {
        console.log(`Skip Ready card without issue URL: ${card.name}`);
      }
      continue;
    }
    const alreadyHasSession = await hasSessionComment(card.id);
    if (alreadyHasSession) {
      if (options.verbose) {
        console.log(`Skip Ready card with session comment: ${card.name}`);
      }
      continue;
    }
    targets.push({
      cardId: card.id,
      issueUrl: issueRef.url,
      repo: issueRef.repo,
      issueNumber: issueRef.issueNumber,
    });
  }

  return targets;
};

export const runAssignedIssueSessions = async (
  targets: AssignedIssueSessionTarget[],
  options: {
    host: string;
    workspaceRoot: string;
    promptPath: string;
    dryRun: boolean;
    verbose: boolean;
  },
) => {
  if (targets.length === 0) {
    return;
  }

  const promptTemplate = await readFile(options.promptPath, "utf8");

  for (const target of targets) {
    const [org, repo] = target.repo.split("/");
    const bareRepoPath = join(options.workspaceRoot, org, `${repo}.git`);
    const worktreePath = join(
      options.workspaceRoot,
      org,
      repo,
      `issue-${target.issueNumber}`,
    );
    const cloneUrl = `schibsted@${options.host}:${target.repo}.git`;

    try {
      await ensureBareRepo(bareRepoPath, cloneUrl, options);
      await runCommand("git", ["-C", bareRepoPath, "fetch", "origin"], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      const baseRef = await resolveBaseRef({
        bareRepoPath,
        dryRun: options.dryRun,
      });
      const baseBranch = baseRef.split("/").pop() ?? "main";
      const baseWorktreePath = join(options.workspaceRoot, org, repo, baseBranch);

      await ensureBranchWorktree({
        bareRepoPath,
        worktreePath,
        baseRef,
        branchName: `issue-${target.issueNumber}`,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
      await ensureBranchWorktree({
        bareRepoPath,
        worktreePath: baseWorktreePath,
        baseRef,
        branchName: baseBranch,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      const title = `Work ${target.repo}#${target.issueNumber}`;
      const prompt = promptTemplate
        .replaceAll("[org/repo]", target.repo)
        .replaceAll("[issue-url]", target.issueUrl);
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
      `${options.host}-issues`,
      "--title",
      title,
      "--group",
      `issues/${org}/${repo}`,
      "--cmd",
      opencodeCmd,
    ];

      await runCommand("aoe", aoeArgs, { dryRun: options.dryRun, verbose: options.verbose });
      await runCommand(
        "aoe",
        ["session", "start", "-p", `${options.host}-issues`, title],
        {
          dryRun: options.dryRun,
          verbose: options.verbose,
        },
      );

      await addSessionComment({
        cardId: target.cardId,
        sessionId,
        dryRun: options.dryRun,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to create issue session for ${target.issueUrl}: ${message}`);
    }
  }
};
