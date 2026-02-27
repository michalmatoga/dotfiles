import { homedir, hostname } from "node:os";
import { join } from "node:path";

import {
  aggregateUniqueDuration,
  aggregateUniqueDurationByDataKey,
  getEvents,
} from "../sessions/activitywatch";
import { loadBoardContext } from "../trello/context";
import { fetchBoardCardsAll } from "../trello/cards";
import { parseSyncMetadata } from "../sync/metadata";
import { readLatestSnapshot } from "../state/snapshots";
import { readJsonlEntries } from "../state/jsonl";
import { getPrimaryLabel } from "./types";

export const NO_CARD_BUCKET = "no-card";
export const NO_LABEL_BUCKET = "no-label";

export type CardTimeEntry = {
  cardId: string;
  url: string | null;
  title: string | null;
  label: string;
  labels: string[];
  durationSeconds: number;
};

export type LabelTimeEntry = {
  label: string;
  durationSeconds: number;
};

export type ActivityWatchSummary = {
  totalSeconds: number;
  cardTimes: CardTimeEntry[];
  labelTotals: LabelTimeEntry[];
  noCardByRepo: Array<{ repo: string; durationSeconds: number }>;
};

type WorktreeAddedEvent = {
  type?: string;
  payload?: { path?: string; url?: string };
};

type CardIndexEntry = {
  cardId: string;
  url: string;
  title: string;
  labels: string[];
};

const eventsPath = "scripts/wo/state/wo-events.jsonl";

const normalizePath = (value: string): string => value.replace(/\/+$/, "");

const isPathWithin = (root: string, target: string): boolean => {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
};

const extractUrlFromDesc = (desc: string): string | null => {
  const match = desc.match(/https:\/\/\S+/);
  return match?.[0] ?? null;
};

const buildPathToUrlMap = async (): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  const snapshot = await readLatestSnapshot();
  const byUrl = snapshot?.worktrees?.byUrl ?? {};
  for (const [url, path] of Object.entries(byUrl)) {
    if (path) {
      map.set(normalizePath(path), url);
    }
  }

  const events = await readJsonlEntries<WorktreeAddedEvent>(eventsPath);
  for (const event of events) {
    if (event.type !== "worktree.added") {
      continue;
    }
    const path = event.payload?.path;
    const url = event.payload?.url;
    if (path && url) {
      map.set(normalizePath(path), url);
    }
  }

  return map;
};

const buildCardIndex = async (boardId: string): Promise<Map<string, CardIndexEntry>> => {
  const context = await loadBoardContext({ boardId, allowCreate: false });
  const cards = await fetchBoardCardsAll(boardId);
  const labelById = new Map<string, string>();
  for (const label of context.labels) {
    if (label.name) {
      labelById.set(label.id, label.name);
    }
  }

  const index = new Map<string, CardIndexEntry>();
  for (const card of cards) {
    const meta = parseSyncMetadata(card.desc);
    const url = meta?.url ?? extractUrlFromDesc(card.desc) ?? card.shortUrl ?? card.url ?? null;
    if (!url) {
      continue;
    }
    const labels = card.idLabels
      .map((id) => labelById.get(id))
      .filter((name): name is string => Boolean(name));
    index.set(url, { cardId: card.id, url, title: card.name, labels });
  }

  return index;
};

const findUrlForPath = (
  panePath: string,
  entries: Array<{ path: string; url: string }>,
): string | null => {
  for (const entry of entries) {
    if (isPathWithin(entry.path, panePath)) {
      return entry.url;
    }
  }
  return null;
};

const isTrackablePath = (panePath: string, roots: string[]): boolean =>
  roots.some((root) => isPathWithin(root, panePath));

const toRepoLabel = (panePath: string): string | null => {
  const match = panePath.match(/\/ghq\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!match) {
    return null;
  }
  const host = match[1];
  const owner = match[2];
  const repoSegment = match[3];
  const repo = repoSegment.split("=")[0] ?? repoSegment;
  if (!host || !owner || !repo) {
    return null;
  }
  return `${host}/${owner}/${repo}`;
};

export const summarizeActivityWatchTime = async (options: {
  start: string;
  end: string;
  boardId: string;
  bucketId?: string;
}): Promise<ActivityWatchSummary> => {
  const bucketId = options.bucketId ?? `aw-watcher-tmux_${hostname()}`;
  const events = await getEvents(bucketId, { start: options.start, end: options.end });
  const totalSeconds = aggregateUniqueDuration(events);
  if (events.length === 0) {
    return { totalSeconds, cardTimes: [], labelTotals: [] };
  }

  const durationByPath = aggregateUniqueDurationByDataKey(events, "pane_path");
  const pathToUrl = await buildPathToUrlMap();
  const entries = Array.from(pathToUrl.entries())
    .map(([path, url]) => ({ path: normalizePath(path), url }))
    .sort((a, b) => b.path.length - a.path.length);
  const cardIndex = await buildCardIndex(options.boardId);
  const roots = [join(homedir(), "ghq")].map(normalizePath);

  const cardTotals = new Map<string, CardTimeEntry>();
  const noCardRepoTotals = new Map<string, number>();
  const addCardDuration = (
    entry: { cardId: string; url: string | null; title: string | null; labels: string[] },
    duration: number,
  ) => {
    const existing = cardTotals.get(entry.cardId);
    const label = entry.cardId === NO_CARD_BUCKET
      ? NO_CARD_BUCKET
      : getPrimaryLabel(entry.labels) ?? NO_LABEL_BUCKET;
    if (existing) {
      existing.durationSeconds += duration;
      return;
    }
    cardTotals.set(entry.cardId, {
      cardId: entry.cardId,
      url: entry.url,
      title: entry.title,
      labels: entry.labels,
      label,
      durationSeconds: duration,
    });
  };

  for (const [panePathRaw, duration] of durationByPath.entries()) {
    const panePath = normalizePath(panePathRaw);
    if (!isTrackablePath(panePath, roots)) {
      continue;
    }
    const url = findUrlForPath(panePath, entries);
    if (!url) {
      addCardDuration({ cardId: NO_CARD_BUCKET, url: null, title: null, labels: [] }, duration);
      const repoLabel = toRepoLabel(panePath);
      if (repoLabel) {
        noCardRepoTotals.set(repoLabel, (noCardRepoTotals.get(repoLabel) ?? 0) + duration);
      }
      continue;
    }
    const card = cardIndex.get(url);
    if (!card) {
      addCardDuration({ cardId: NO_CARD_BUCKET, url: null, title: null, labels: [] }, duration);
      const repoLabel = toRepoLabel(panePath);
      if (repoLabel) {
        noCardRepoTotals.set(repoLabel, (noCardRepoTotals.get(repoLabel) ?? 0) + duration);
      }
      continue;
    }
    addCardDuration({ cardId: card.cardId, url: card.url, title: card.title, labels: card.labels }, duration);
  }

  const cardTimes = Array.from(cardTotals.values()).sort(
    (a, b) => b.durationSeconds - a.durationSeconds,
  );

  const labelMap = new Map<string, number>();
  for (const entry of cardTimes) {
    const key = entry.label || NO_LABEL_BUCKET;
    labelMap.set(key, (labelMap.get(key) ?? 0) + entry.durationSeconds);
  }

  const labelTotals = Array.from(labelMap.entries())
    .map(([label, durationSeconds]) => ({ label, durationSeconds }))
    .sort((a, b) => b.durationSeconds - a.durationSeconds);

  const noCardByRepo = Array.from(noCardRepoTotals.entries())
    .map(([repo, durationSeconds]) => ({ repo, durationSeconds }))
    .filter((entry) => entry.durationSeconds >= 60)
    .sort((a, b) => b.durationSeconds - a.durationSeconds);

  return { totalSeconds, cardTimes, labelTotals, noCardByRepo };
};
