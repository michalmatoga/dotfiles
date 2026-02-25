import { access } from "node:fs/promises";

import { listNames } from "../lib/policy/mapping";
import { requireEnv } from "../lib/env";
import { loadBoardContext } from "../lib/trello/context";
import { loadLabelRepoMap, resolveLabelRepo } from "../lib/trello/label-mapping";
import { readJsonlEntries } from "../lib/state/jsonl";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { writeEvent } from "../lib/state/events";
import { ghJson } from "../lib/gh/gh";
import {
  buildWorktreePath,
  buildWorktreePathForRepo,
  ensureWorktreeForUrl,
  ensureWorktreeForRepo,
  parseGitHubUrl,
  removeWorktreeForUrl,
  removeWorktreeForPath,
  resolveWorkItemName,
  slugifyWorktreeSegment,
} from "../lib/worktrees/worktrees";
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

const eventsPath = "scripts/wo/state/wo-events.jsonl";
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

const isTrelloUrl = (url: string) => /^https:\/\/trello\.com\/c\//.test(url);

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

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const syncWorktreesUseCase = async (options: { verbose: boolean }) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const context = await loadBoardContext({ boardId, allowCreate: false });
  const labelById = new Map(
    context.labels
      .filter((label) => Boolean(label.name))
      .map((label) => [label.id, label.name as string]),
  );
  const labelRepoMap = await loadLabelRepoMap();
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
    const { url, toList, cardId, name, labels } = event.payload;
    if (!url || !toList) {
      await writeEvent({
        ts: event.ts,
        type: "worktree.skipped.missing-url",
        payload: { cardId },
      });
      continue;
    }

    const isGitHub = Boolean(parseGitHubUrl(url));
    const isTrello = isTrelloUrl(url);
    if (!isGitHub && !isTrello) {
      await writeEvent({
        ts: event.ts,
        type: "worktree.skipped.unmatched-url",
        payload: { cardId, url },
      });
      continue;
    }

    const title = isGitHub ? (await fetchTitle(url)) ?? name ?? "work" : name ?? "work";

    if (toList === listNames.doing) {
      if (isTrello) {
        const labelNames = (labels ?? [])
          .map((id) => labelById.get(id))
          .filter((value): value is string => Boolean(value));
        const resolution = resolveLabelRepo({ labelNames, mapping: labelRepoMap });
        if (resolution.status === "multiple") {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.multiple-labels",
            payload: { cardId, url, labels: resolution.labels },
          });
          continue;
        }
        if (resolution.status === "none") {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.unmapped-label",
            payload: { cardId, url, labels: labelNames },
          });
          continue;
        }

        const segment = slugifyWorktreeSegment(title);
        const existingPath = worktreeMap[url];
        if (existingPath && (await pathExists(existingPath))) {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.exists",
            payload: { cardId, url, path: existingPath },
          });
          if (sessionTriggerLists.includes(toList)) {
            const session = await initializeWorkSession({
              url,
              worktreePath: existingPath,
              title,
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
                worktreePath: existingPath,
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
                  logPath: session.logPath ?? null,
                  title: session.title,
                  kind: session.kind,
                  worktreePath: existingPath,
                },
              });
            }
          }
          continue;
        }

        const deterministicPath = buildWorktreePathForRepo(resolution.repoPath, segment);
        if (deterministicPath && (await pathExists(deterministicPath))) {
          worktreeMap[url] = deterministicPath;
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.exists",
            payload: { cardId, url, path: deterministicPath },
          });
          if (sessionTriggerLists.includes(toList)) {
            const session = await initializeWorkSession({
              url,
              worktreePath: deterministicPath,
              title,
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
                worktreePath: deterministicPath,
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
                  logPath: session.logPath ?? null,
                  title: session.title,
                  kind: session.kind,
                  worktreePath: deterministicPath,
                },
              });
            }
          }
          continue;
        }

        const result = await ensureWorktreeForRepo({
          repoPath: resolution.repoPath,
          segment,
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

        if (sessionTriggerLists.includes(toList)) {
          const session = await initializeWorkSession({
            url,
            worktreePath: result.worktreePath,
            title,
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
                logPath: session.logPath ?? null,
                title: session.title,
                kind: session.kind,
                worktreePath: result.worktreePath,
              },
            });
          }
        }
        continue;
      }

      const existingPath = worktreeMap[url];
      if (existingPath && (await pathExists(existingPath))) {
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.exists",
          payload: { cardId, url, path: existingPath },
        });
        if (sessionTriggerLists.includes(toList)) {
          const session = await initializeWorkSession({
            url,
            worktreePath: existingPath,
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
              worktreePath: existingPath,
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
                logPath: session.logPath ?? null,
                title: session.title,
                kind: session.kind,
                worktreePath: existingPath,
              },
            });
          }
        }
        continue;
      }

      const resolvedName = resolveWorkItemName({ url, title });
      const deterministicPath = resolvedName ? buildWorktreePath(url, resolvedName) : null;
      if (deterministicPath && (await pathExists(deterministicPath))) {
        worktreeMap[url] = deterministicPath;
        await writeEvent({
          ts: event.ts,
          type: "worktree.skipped.exists",
          payload: { cardId, url, path: deterministicPath },
        });
        if (sessionTriggerLists.includes(toList)) {
          const session = await initializeWorkSession({
            url,
            worktreePath: deterministicPath,
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
              worktreePath: deterministicPath,
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
                logPath: session.logPath ?? null,
                title: session.title,
                kind: session.kind,
                worktreePath: deterministicPath,
              },
            });
          }
        }
        continue;
      }

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
              logPath: session.logPath ?? null,
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
      let mappedPath = worktreeMap[url] ?? null;
      if (isTrello && !mappedPath) {
        const labelNames = (labels ?? [])
          .map((id) => labelById.get(id))
          .filter((value): value is string => Boolean(value));
        const resolution = resolveLabelRepo({ labelNames, mapping: labelRepoMap });
        if (resolution.status === "multiple") {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.multiple-labels",
            payload: { cardId, url, labels: resolution.labels },
          });
          continue;
        }
        if (resolution.status === "none") {
          await writeEvent({
            ts: event.ts,
            type: "worktree.skipped.unmapped-label",
            payload: { cardId, url, labels: labelNames },
          });
          continue;
        }
        const segment = slugifyWorktreeSegment(title);
        const deterministicPath = buildWorktreePathForRepo(resolution.repoPath, segment);
        if (deterministicPath && (await pathExists(deterministicPath))) {
          mappedPath = deterministicPath;
        }
      }

      const result = isTrello
        ? mappedPath
          ? await removeWorktreeForPath({ worktreePath: mappedPath, verbose: options.verbose })
          : null
        : await removeWorktreeForUrl({
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
