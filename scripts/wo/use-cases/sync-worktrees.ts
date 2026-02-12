import { listNames } from "../lib/policy/mapping";
import { readJsonlEntries } from "../lib/state/jsonl";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { writeEvent } from "../lib/state/events";
import { ensureWorktreeForUrl, removeWorktreeForUrl } from "../lib/worktrees/worktrees";

type TrelloMovedEvent = {
  ts: string;
  type: string;
  payload: {
    cardId: string;
    url: string | null;
    fromList: string | null;
    toList: string | null;
    itemId?: string | null;
    labels?: string[];
  };
};

const eventsPath = "scripts/wo/state/wf-events.jsonl";

const isAfter = (ts: string, last: string | null) => {
  if (!last) {
    return true;
  }
  return new Date(ts).getTime() > new Date(last).getTime();
};

export const syncWorktreesUseCase = async (options: { dryRun: boolean; verbose: boolean }) => {
  const snapshot = await readLatestSnapshot();
  const lastEventTs = snapshot?.worktrees?.lastEventTs ?? null;
  const events = await readJsonlEntries<TrelloMovedEvent>(eventsPath);
  const moves = events.filter(
    (event) => event.type === "trello.card.moved" && isAfter(event.ts, lastEventTs),
  );

  if (moves.length === 0) {
    return;
  }

  let newestTs = lastEventTs;
  for (const event of moves) {
    newestTs = event.ts;
    const { url, toList, cardId } = event.payload;
    if (!url || !toList) {
      if (!options.dryRun) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.missing-url",
          payload: { cardId },
        });
      }
      continue;
    }

    if (toList === listNames.doing) {
      const result = await ensureWorktreeForUrl({ url, dryRun: options.dryRun, verbose: options.verbose });
      if (!result) {
        if (!options.dryRun) {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.unmatched-url",
            payload: { cardId, url },
          });
        }
        continue;
      }
      if (!options.dryRun) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.added",
          payload: { cardId, url, branch: result.branch, path: result.worktreePath },
        });
      }
      continue;
    }

    if (toList === listNames.done) {
      const result = await removeWorktreeForUrl({ url, dryRun: options.dryRun, verbose: options.verbose });
      if (result === "dirty") {
        if (!options.dryRun) {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.dirty",
            payload: { cardId, url },
          });
        }
        continue;
      }
      if (!result) {
        if (!options.dryRun) {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.missing",
            payload: { cardId, url },
          });
        }
        continue;
      }
      if (!options.dryRun) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.removed",
          payload: { cardId, url, branch: result.branch, path: result.worktreePath },
        });
      }
    }
  }

  if (!options.dryRun && newestTs) {
    await writeSnapshot({
      ts: newestTs,
      trello: snapshot?.trello,
      project: snapshot?.project,
      worktrees: { lastEventTs: newestTs },
    });
  }
};
