import { listNames } from "../lib/policy/mapping";
import { readJsonlEntries } from "../lib/state/jsonl";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { writeEvent } from "../lib/state/events";
import { ghJson } from "../lib/gh/gh";
import { buildWorktreePath, ensureWorktreeForUrl, removeWorktreeForUrl } from "../lib/worktrees/worktrees";

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
    name?: string | null;
  };
};

const eventsPath = "scripts/wo/state/wf-events.jsonl";
const titleCache = new Map<string, string | null>();

const extractNumber = (url: string) => {
  const match = url.match(/\/(issues|pull)\/(\d+)$/);
  if (!match) {
    return "0";
  }
  return match[2];
};

const extractHost = (url: string) => {
  const match = url.match(/^https:\/\/([^/]+)/);
  return match ? match[1] : null;
};

const extractKind = (url: string) => {
  const match = url.match(/\/(issues|pull)\//);
  if (!match) {
    return null;
  }
  return match[1] === "pull" ? "pr" : "issue";
};

const fetchTitle = async (url: string): Promise<string | null> => {
  if (titleCache.has(url)) {
    return titleCache.get(url) ?? null;
  }
  const host = extractHost(url);
  const kind = extractKind(url);
  if (!host || !kind) {
    titleCache.set(url, null);
    return null;
  }
  try {
    if (kind === "issue") {
      const response = await ghJson<{ title: string }>(["issue", "view", url, "--json", "title"], {
        host,
      });
      titleCache.set(url, response.title);
      return response.title;
    }
    const response = await ghJson<{ title: string }>(["pr", "view", url, "--json", "title"], { host });
    titleCache.set(url, response.title);
    return response.title;
  } catch {
    titleCache.set(url, null);
    return null;
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

const isAfter = (ts: string, last: string | null) => {
  if (!last) {
    return true;
  }
  return new Date(ts).getTime() > new Date(last).getTime();
};

export const syncWorktreesUseCase = async (options: { dryRun: boolean; verbose: boolean }) => {
  const snapshot = await readLatestSnapshot();
  const lastEventTs = snapshot?.worktrees?.lastEventTs ?? null;
  const worktreeMap = snapshot?.worktrees?.byUrl ?? {};
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
    const { url, toList, cardId, name } = event.payload;
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

    const title = (await fetchTitle(url)) ?? name ?? "work";
    const slug = slugify(title);
    const segment = `${extractNumber(url)}-${slug}`;
    const worktreePath = buildWorktreePath(url, segment);

    if (toList === listNames.doing) {
      const result = await ensureWorktreeForUrl({
        url,
        path: worktreePath,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
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
        worktreeMap[url] = result.worktreePath;
      }
      continue;
    }

    if (toList === listNames.done) {
      const mappedPath = worktreeMap[url] ?? worktreePath;
      const result = await removeWorktreeForUrl({
        url,
        path: mappedPath,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
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
        delete worktreeMap[url];
      }
    }
  }

  if (!options.dryRun && newestTs) {
    await writeSnapshot({
      ts: newestTs,
      trello: snapshot?.trello,
      project: snapshot?.project,
      worktrees: { lastEventTs: newestTs, byUrl: worktreeMap },
    });
  }
};
