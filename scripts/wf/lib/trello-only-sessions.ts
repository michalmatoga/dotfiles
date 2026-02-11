import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand, runCommandCapture } from "./command";
import { loadEnvFile, requireEnv } from "./env";
import { buildOpencodeResumeCommand, runInitialOpencode } from "./opencode";
import { trelloRequest, type TrelloCard, type TrelloComment } from "./trello";

export type TrelloOnlySessionTarget = {
  cardId: string;
  cardName: string;
  cardUrl: string;
  repoLabel: string;
  cloneUrl: string;
  workspaceRepoPath: string;
};

const trelloBoardId = "HZ7hcWZy";
const trelloReadyListId = "6689284f81d51c086a80879c";
const trelloDoingListId = "668928577acb6ab04b723321";
const trelloEnvFile = ".env";
const sessionMarkerRegex = /\bopencode\s+-s\s+\S+/i;
const dwpLabelName = "dwp";
const repoLabelMappings = new Map<string, { cloneUrl: string; workspacePath: string }>([
  ["dotfiles", {
    cloneUrl: "git@github.com:michalmatoga/dotfiles.git",
    workspacePath: "michalmatoga/dotfiles",
  }],
  ["Elikonas", {
    cloneUrl: "git@github.com:elikonas/elikonas.git",
    workspacePath: "elikonas/elikonas",
  }],
]);

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels,idList,labels,shortUrl,url",
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

const slugify = (input: string) => {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length <= 80) {
    return cleaned;
  }
  return cleaned.slice(0, 80).replace(/-+$/g, "");
};

const resolveCardUrl = (card: TrelloCard): string | null => {
  if (card.shortUrl) {
    return card.shortUrl;
  }
  if (card.url) {
    return card.url;
  }
  return null;
};

const resolveRepoMapping = (card: TrelloCard) => {
  const labels = card.labels ?? [];
  for (const label of labels) {
    const mapping = repoLabelMappings.get(label.name);
    if (mapping) {
      return { repoLabel: label.name, mapping };
    }
  }
  return null;
};

export const fetchTrelloOnlySessionTargets = async (options: {
  verbose: boolean;
}): Promise<TrelloOnlySessionTarget[]> => {
  await loadEnvFile(trelloEnvFile);
  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const openCards = await fetchOpenCards();
  const targets: TrelloOnlySessionTarget[] = [];

  const eligibleListIds = new Set([trelloReadyListId, trelloDoingListId]);

  for (const card of openCards) {
    if (!card.idList || !eligibleListIds.has(card.idList)) {
      continue;
    }
    const labels = card.labels ?? [];
    const hasDwpLabel = labels.some((label) => label.name === dwpLabelName);
    if (!hasDwpLabel) {
      continue;
    }
    const mapping = resolveRepoMapping(card);
    if (!mapping) {
      if (options.verbose) {
        console.log(`Skip dwp card without repo label: ${card.name}`);
      }
      continue;
    }
    const cardUrl = resolveCardUrl(card);
    if (!cardUrl) {
      if (options.verbose) {
        console.log(`Skip dwp card without card URL: ${card.name}`);
      }
      continue;
    }
    const alreadyHasSession = await hasSessionComment(card.id);
    if (alreadyHasSession) {
      if (options.verbose) {
        console.log(`Skip dwp card with session comment: ${card.name}`);
      }
      continue;
    }
    targets.push({
      cardId: card.id,
      cardName: card.name,
      cardUrl,
      repoLabel: mapping.repoLabel,
      cloneUrl: mapping.mapping.cloneUrl,
      workspaceRepoPath: mapping.mapping.workspacePath,
    });
  }

  return targets;
};

export const runTrelloOnlySessions = async (
  targets: TrelloOnlySessionTarget[],
  options: {
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
    const [org, repo] = target.workspaceRepoPath.split("/");
    const bareRepoPath = join(options.workspaceRoot, org, `${repo}.git`);
    const slug = slugify(`${target.repoLabel}-${target.cardName}`);
    const worktreePath = join(options.workspaceRoot, org, repo, slug);

    try {
      await ensureBareRepo(bareRepoPath, target.cloneUrl, options);
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
        branchName: `trello-${slug}`,
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

      const title = `Work ${slug}`;
      const prompt = promptTemplate
        .replaceAll("[org/repo]", target.repoLabel)
        .replaceAll("[issue-url]", target.cardUrl);
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
        "--title",
        title,
        "--group",
        `issues/${org}/${repo}`,
        "--cmd",
        opencodeCmd,
      ];

      await runCommand("aoe", aoeArgs, { dryRun: options.dryRun, verbose: options.verbose });
      await runCommand("aoe", ["session", "start", title], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      await addSessionComment({
        cardId: target.cardId,
        sessionId,
        dryRun: options.dryRun,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to create Trello-only session for ${target.cardName}: ${message}`);
    }
  }
};
