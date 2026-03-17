import { readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import { requireEnv } from "../lib/env";
import { fetchBoardCardsAll } from "../lib/trello/cards";
import { loadBoardContext } from "../lib/trello/context";
import { listAliases, listNames } from "../lib/policy/mapping";
import { parseSyncMetadata } from "../lib/sync/metadata";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { writeEvent } from "../lib/state/events";
import { removeWorktreeForUrl, removeWorktreeForPath } from "../lib/worktrees/worktrees";
import { cleanupWorkSession } from "../lib/sessions/tmux";

type PruneReason = "done" | "archived";
type ResidualPathCleanup = "removed" | "missing" | "skipped" | "unsafe";

const canonicalListName = (name: string) => listAliases[name] ?? name;
const isTrelloUrl = (url: string) => /^https:\/\/trello\.com\/c\//.test(url);

const isPathWithin = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && rel !== target;
};

const cleanupResidualWorktreePath = async (options: { path: string; verbose: boolean }): Promise<ResidualPathCleanup> => {
  const normalizedPath = resolve(options.path);
  const home = homedir();
  const allowedRoots = [join(home, "ghq"), join(home, "gwq")].map((root) => resolve(root));
  const underAllowedRoot = allowedRoots.some((root) => isPathWithin(root, normalizedPath));
  if (!underAllowedRoot) {
    return "unsafe";
  }

  let entries;
  try {
    entries = await readdir(normalizedPath, { withFileTypes: true });
  } catch {
    return "missing";
  }

  if (entries.length === 0) {
    await rm(normalizedPath, { recursive: false, force: true });
    return "removed";
  }

  const allowedResidualNames = new Set([".nx", ".DS_Store"]);
  if (entries.some((entry) => !allowedResidualNames.has(entry.name))) {
    return "skipped";
  }

  for (const entry of entries) {
    await rm(join(normalizedPath, entry.name), { recursive: true, force: true });
  }
  await rm(normalizedPath, { recursive: false, force: true });
  if (options.verbose) {
    console.log(`Cleaned residual worktree path: ${normalizedPath}`);
  }
  return "removed";
};

export const pruneWorktreesUseCase = async (options: { verbose: boolean }) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const snapshot = await readLatestSnapshot();
  const worktreeMap = snapshot?.worktrees?.byUrl ?? null;
  if (!worktreeMap || Object.keys(worktreeMap).length === 0) {
    return;
  }

  const context = await loadBoardContext({ boardId, allowCreate: false, allowCreateLabels: true });
  const cards = await fetchBoardCardsAll(boardId);
  const cardByUrl = new Map<string, (typeof cards)[number]>();
  const listById = new Map(context.lists.map((list) => [list.id, list]));

  for (const card of cards) {
    const meta = parseSyncMetadata(card.desc);
    const cardUrl = meta?.url ?? card.shortUrl ?? card.url ?? null;
    if (cardUrl) {
      cardByUrl.set(cardUrl, card);
    }
  }

  const now = new Date().toISOString();
  const doneName = listNames.done;
  const nextWorktrees = { ...worktreeMap };
  let changed = false;

  for (const [url, path] of Object.entries(worktreeMap)) {
    const card = cardByUrl.get(url);
    if (!card) {
      await writeEvent({
        ts: now,
        type: "worktree.skipped.missing-card",
        payload: { url, path },
      });
      continue;
    }

    const list = listById.get(card.idList);
    const listName = list ? canonicalListName(list.name) : null;
    const isDone = listName === doneName;
    const isArchived = card.closed === true;
    if (!isDone && !isArchived) {
      continue;
    }

    const reason: PruneReason = isArchived ? "archived" : "done";
    const title = card.name ?? "work";
    const result = isTrelloUrl(url)
      ? await removeWorktreeForPath({ worktreePath: path, verbose: options.verbose })
      : await removeWorktreeForUrl({
          url,
          title,
          path,
          verbose: options.verbose,
        });
    if (result === "dirty") {
      await writeEvent({
        ts: now,
        type: "worktree.skipped.dirty",
        payload: { url, path, reason },
      });
      continue;
    }
    if (!result) {
      await writeEvent({
        ts: now,
        type: "worktree.skipped.missing",
        payload: { url, path, reason },
      });
      continue;
    }

    await writeEvent({
      ts: now,
      type: "worktree.removed",
      payload: { url, path: result.worktreePath, branch: result.branch, reason },
    });
    delete nextWorktrees[url];
    changed = true;

    const cleanup = await cleanupWorkSession({
      worktreePath: result.worktreePath,
      verbose: options.verbose,
    });
    if (cleanup.status === "removed") {
      await writeEvent({
        ts: new Date().toISOString(),
        type: "tmux.session.removed",
        payload: {
          url,
          sessionName: cleanup.sessionName,
          worktreePath: result.worktreePath,
        },
      });
    }

    const residualCleanup = await cleanupResidualWorktreePath({
      path: result.worktreePath,
      verbose: options.verbose,
    });
    if (residualCleanup === "removed") {
      await writeEvent({
        ts: new Date().toISOString(),
        type: "worktree.path.cleaned",
        payload: {
          url,
          path: result.worktreePath,
        },
      });
    }
  }

  if (!changed) {
    return;
  }

  await writeSnapshot({
    ts: now,
    trello: snapshot?.trello,
    project: snapshot?.project,
    worktrees: {
      lastEventTs: snapshot?.worktrees?.lastEventTs ?? null,
      byUrl: nextWorktrees,
    },
    lss: snapshot?.lss ?? null,
  });
};
