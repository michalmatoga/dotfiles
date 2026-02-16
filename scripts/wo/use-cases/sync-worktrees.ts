import { listNames } from "../lib/policy/mapping";
import { readJsonlEntries } from "../lib/state/jsonl";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { writeEvent } from "../lib/state/events";
import { ghJson } from "../lib/gh/gh";
import { ensureWorktreeForUrl, removeWorktreeForUrl } from "../lib/worktrees/worktrees";
import { cleanupWorkSession, initializeWorkSession } from "../lib/sessions/tmux";

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
const sessionTriggerLists = (process.env.WO_SESSION_TRIGGER_LISTS ?? listNames.doing)
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

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

const isAfter = (ts: string, last: string | null) => {
  if (!last) {
    return true;
  }
  return new Date(ts).getTime() > new Date(last).getTime();
};

export const syncWorktreesUseCase = async (options: { verbose: boolean }) => {
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
      await writeEvent({
        ts: event.ts,
        type: "worktree.skipped.missing-url",
        payload: { cardId },
      });
      continue;
    }

    const title = (await fetchTitle(url)) ?? name ?? "work";

    if (toList === listNames.doing) {
      const result = await ensureWorktreeForUrl({
        url,
        title,
        verbose: options.verbose,
      });
      if (!result) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.unmatched-url",
          payload: { cardId, url },
        });
        continue;
      }
      await writeEvent({
        ts: event.ts,
        type: "worktree.added",
        payload: { cardId, url, branch: result.branch, path: result.worktreePath },
      });
      worktreeMap[url] = result.worktreePath;
      if (result.fallbackUsed) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.name.fallback",
          payload: {
            cardId,
            url,
            branch: result.branch,
            path: result.worktreePath,
            reason: result.fallbackReason,
          },
        });
      }

      if (sessionTriggerLists.includes(toList)) {
        const session = await initializeWorkSession({
          url,
          worktreePath: result.worktreePath,
          verbose: options.verbose,
        });
        const eventType = session.status === "exists" ? "tmux.session.exists" : "tmux.session.created";
        await writeEvent({
          ts: new Date().toISOString(),
          type: eventType,
          payload: {
            cardId,
            url,
            sessionName: session.sessionName,
            sessionId: session.sessionId,
            title: session.title,
            kind: session.kind,
            worktreePath: result.worktreePath,
          },
        });
        if (session.sessionId) {
          await writeEvent({
            ts: new Date().toISOString(),
            type: "opencode.session.created",
            payload: {
              cardId,
              url,
              sessionId: session.sessionId,
              title: session.title,
              kind: session.kind,
              worktreePath: result.worktreePath,
            },
          });
        }
      }
      continue;
    }

    if (toList === listNames.done) {
      const mappedPath = worktreeMap[url];
      const result = await removeWorktreeForUrl({
        url,
        title,
        path: mappedPath,
        verbose: options.verbose,
      });
      if (result === "dirty") {
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.dirty",
          payload: { cardId, url },
        });
        continue;
      }
      if (!result) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.missing",
          payload: { cardId, url },
        });
        continue;
      }
      await writeEvent({
        ts: event.ts,
        type: "worktree.removed",
        payload: { cardId, url, branch: result.branch, path: result.worktreePath },
      });
      delete worktreeMap[url];
      if (result.fallbackUsed) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.name.fallback",
          payload: {
            cardId,
            url,
            branch: result.branch,
            path: result.worktreePath,
            reason: result.fallbackReason,
          },
        });
      }
      const cleanup = await cleanupWorkSession({
        worktreePath: result.worktreePath,
        verbose: options.verbose,
      });
      if (cleanup.status === "removed") {
        await writeEvent({
          ts: new Date().toISOString(),
          type: "tmux.session.removed",
          payload: {
            cardId,
            url,
            sessionName: cleanup.sessionName,
            worktreePath: result.worktreePath,
          },
        });
      }
    }
  }

  if (newestTs) {
    await writeSnapshot({
      ts: newestTs,
      trello: snapshot?.trello,
      project: snapshot?.project,
      worktrees: { lastEventTs: newestTs, byUrl: worktreeMap },
    });
  }
};
