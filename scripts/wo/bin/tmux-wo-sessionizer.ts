#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMetricsRecord } from "../lib/metrics/types";
import {
  aggregateUniqueDurationByDataKey,
  getActivityWatchConfig,
  getTodayTimeRange,
  type AWEvent,
} from "../lib/sessions/activitywatch";

type EntryKind = "worktree" | "repo";

type Entry = {
  path: string;
  kind: EntryKind;
  url?: string | null;
  host?: string | null;
  owner?: string | null;
  repo?: string | null;
  leaf?: string | null;
};

type CardListState = {
  cardId: string;
  list: string;
  enteredAt: string;
  labels?: string[];
  url: string | null;
};

type LifecycleData = {
  leadStartByCardId: Map<string, number>;
  completedCycles: Array<{ cardId: string; completedAt: number; cycleSeconds: number; label: string | null }>;
  completedCycleByCardId: Map<string, number>;
  doneEntries: Array<{ cardId: string; completedAt: number; label: string | null }>;
};

type FileSignature = {
  mtimeMs: number;
  size: number;
};

type SignatureCache<T> = {
  sourcePath: string;
  sourceSignature: FileSignature;
  payload: T;
};

type RankedEntry = {
  entry: Entry;
  category: number;
  ageSeconds: number | null;
  label: string;
  badge: string;
  isReviewRequest: boolean;
};

type PitWallAwCache = {
  savedAt: number;
  start: string;
  bucketId: string;
  labels: string[];
  totals: Record<string, number>;
};

const delimiter = "\u001f";
const defaultBadge = "[·   --    ]";
const ansiReset = "\u001b[0m";
const reviewLineAnsi = "\u001b[38;5;141m";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const stateDir = join(repoRoot, "scripts/wo/state");
const eventsPath = join(stateDir, "wo-events.jsonl");
const cardStatePath = join(stateDir, "wo-card-states.jsonl");
const metricsPath = join(stateDir, "wo-metrics.csv");
const snapshotsPath = join(stateDir, "wo-snapshots.jsonl");
const worktreeUrlMapCachePath = join(stateDir, "tmux-wo-sessionizer-worktree-url-map-cache.json");
const snapshotWorktreeUrlMapCachePath = join(stateDir, "tmux-wo-sessionizer-snapshot-worktree-url-map-cache.json");
const cardStateByUrlCachePath = join(stateDir, "tmux-wo-sessionizer-card-state-by-url-cache.json");
const lifecycleCachePath = join(stateDir, "tmux-wo-sessionizer-lifecycle-cache.json");
const pitWallAwCachePath = join(stateDir, "tmux-wo-sessionizer-pitwall-aw-cache.json");
const dirCacheTtlMs = 30_000;
const pitWallAwCacheTtlMs = 60_000;
const headerWindowWorkdays = 30;
const minCycleSecondsForBest = 60;
const pitWallDefaultLabels = ["career", "review", "business"];
const pitWallFallbackCycleSeconds = 8 * 60 * 60;
const pitWallCyclePercentile = 0.7;
const pitWallLabelMinSamples = 4;
const pitWallThroughputWindowDays = 7;

const args = process.argv.slice(2);
const argPath = args.find((arg) => !arg.startsWith("--")) ?? null;
const includeRepos = !(args.includes("--worktree-only") || args.includes("--gwq-only"));
const dryRun = args.includes("--dry-run");
const debugEnabled = args.includes("--debug") || process.env.WO_SESSIONIZER_DEBUG === "1";

const run = (command: string, commandArgs: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) => {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(stderr || `Command failed: ${command}`);
  }
  return (result.stdout ?? "").toString();
};

const runOptional = (command: string, commandArgs: string[], input?: string, env?: NodeJS.ProcessEnv) => {
  try {
    return run(command, commandArgs, { input, env });
  } catch {
    return "";
  }
};

const debugLog = (message: string) => {
  if (!debugEnabled) {
    return;
  }
  ensureStateDir();
  const logPath = join(stateDir, "tmux-wo-sessionizer-debug.log");
  const ts = new Date().toISOString();
  writeFileSync(logPath, `${ts} ${message}\n`, { encoding: "utf8", flag: "a" });
};

const readLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const ensureStateDir = () => {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
};

const readJsonFile = <T>(path: string): T | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

const writeJsonFile = (path: string, payload: unknown) => {
  ensureStateDir();
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
};

const getFileSignature = (path: string): FileSignature | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return null;
  }
};

const isSameFileSignature = (a: FileSignature | null, b: FileSignature | null) => {
  if (!a || !b) {
    return false;
  }
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
};

const readSignatureCache = <T>(cachePath: string, sourcePath: string, sourceSignature: FileSignature | null): T | null => {
  if (!sourceSignature) {
    return null;
  }
  const cached = readJsonFile<SignatureCache<T>>(cachePath);
  if (!cached) {
    return null;
  }
  if (cached.sourcePath !== sourcePath || !isSameFileSignature(cached.sourceSignature, sourceSignature)) {
    return null;
  }
  return cached.payload;
};

const writeSignatureCache = <T>(
  cachePath: string,
  sourcePath: string,
  sourceSignature: FileSignature | null,
  payload: T,
) => {
  if (!sourceSignature) {
    return;
  }
  writeJsonFile(cachePath, { sourcePath, sourceSignature, payload } satisfies SignatureCache<T>);
};

const pathToSessionName = (path: string) => {
  const home = homedir();
  const rel = path.startsWith(home) ? relative(home, path) : path;
  return rel.replace(/[/.]/g, "_");
};

const normalizePath = (value: string) => value.replace(/\/+$/, "");
const normalizeCardUrl = (value: string) => {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
};

const addWorktreeUrlMapping = (map: Map<string, string>, path: string, url: string) => {
  const normalizedPath = normalizePath(path);
  const normalizedUrl = normalizeCardUrl(url);
  map.set(normalizedPath, normalizedUrl);

  const home = homedir();
  const rel = relative(home, normalizedPath);
  const segments = rel.split("/").filter(Boolean);
  if (segments.length < 4) {
    return;
  }

  const root = segments[0];
  const host = segments[1];
  const owner = segments[2];
  const repoSegment = segments[3];
  if (!host || !owner || !repoSegment) {
    return;
  }

  if (root === "gwq") {
    const leaf = segments[segments.length - 1];
    if (!leaf || segments.length < 5) {
      return;
    }
    const ghqAlias = join(home, "ghq", host, owner, `${repoSegment}=${leaf}`);
    map.set(normalizePath(ghqAlias), normalizedUrl);
    return;
  }

  if (root === "ghq") {
    const separatorIndex = repoSegment.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }
    const repo = repoSegment.slice(0, separatorIndex);
    const leaf = repoSegment.slice(separatorIndex + 1);
    if (!repo || !leaf) {
      return;
    }
    const gwqAlias = join(home, "gwq", host, owner, repo, leaf);
    map.set(normalizePath(gwqAlias), normalizedUrl);
  }
};

const formatPathSegments = (segments: Array<string | null>) =>
  segments.filter((value): value is string => Boolean(value)).join(" › ");

const formatWorktreeLabel = (entry: Entry) => {
  const label = formatPathSegments([entry.host, entry.owner, entry.repo, entry.leaf]);
  return label || entry.path;
};

const formatRepoLabel = (entry: Entry) => {
  const label = formatPathSegments([entry.host, entry.owner, entry.repo]);
  if (!label) {
    return entry.path;
  }
  if (entry.leaf) {
    return `${label} › ${entry.leaf} (repo)`;
  }
  return `${label} (repo)`;
};

const ensureFzfPath = () => {
  const fzfDir = join(homedir(), ".fzf", "bin");
  const current = process.env.PATH ?? "";
  if (current.split(":").includes(fzfDir)) {
    return current;
  }
  return `${fzfDir}:${current}`;
};

const resolveSessionIdByName = (sessionName: string): string | null => {
  const output = runOptional("tmux", ["list-sessions", "-F", "#{session_id}\t#{session_name}"]);
  if (!output) {
    return null;
  }
  for (const line of readLines(output)) {
    const [sessionId, name] = line.split("\t");
    if (name === sessionName && sessionId) {
      return sessionId;
    }
  }
  return null;
};

const ensureSessionLayout = (sessionTarget: string, selectedPath: string) => {
  const paneIds = readLines(runOptional("tmux", ["list-panes", "-t", sessionTarget, "-F", "#{pane_id}"]));
  debugLog(`layout sessionTarget=${sessionTarget} panes=${paneIds.length}`);
  if (paneIds.length >= 2 || paneIds.length === 0) {
    return;
  }
  run("tmux", ["split-window", "-h", "-t", sessionTarget, "-c", selectedPath]);
  run("tmux", ["resize-pane", "-t", sessionTarget, "-x", "92"]);
};

const parseIso = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const parsePitWallLabels = () => {
  const raw = process.env.WO_SESSIONIZER_PITWALL_LABELS;
  if (!raw) {
    return pitWallDefaultLabels;
  }
  const parsed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (parsed.length === 0) {
    return pitWallDefaultLabels;
  }
  return Array.from(new Set(parsed));
};

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const findUrlForPanePath = (
  panePath: string,
  entries: Array<{ path: string; url: string }>,
): string | null => {
  for (const entry of entries) {
    if (panePath === entry.path || panePath.startsWith(`${entry.path}/`)) {
      return entry.url;
    }
  }
  return null;
};

const loadPitWallAwSecondsByLabel = (options: {
  labels: string[];
  cardStateByUrl: Map<string, CardListState>;
  worktreeUrlMap: Map<string, string>;
}): Map<string, number> | null => {
  if (options.labels.length === 0) {
    return new Map();
  }

  const { start, end } = getTodayTimeRange();
  const bucketId = process.env.WO_SESSIONIZER_AW_BUCKET_ID ?? `aw-watcher-tmux_${hostname()}`;
  const now = Date.now();

  const cached = readJsonFile<PitWallAwCache>(pitWallAwCachePath);
  if (
    cached
    && now - cached.savedAt < pitWallAwCacheTtlMs
    && cached.start === start
    && cached.bucketId === bucketId
    && arraysEqual(cached.labels, options.labels)
  ) {
    const totals = new Map<string, number>();
    for (const label of options.labels) {
      totals.set(label, cached.totals[label] ?? 0);
    }
    return totals;
  }

  const config = getActivityWatchConfig();
  const params = new URLSearchParams({ start, end });
  const response = runOptional("curl", ["-fsS", `${config.baseUrl}/buckets/${bucketId}/events?${params.toString()}`]);
  if (!response) {
    return null;
  }

  let events: AWEvent[];
  try {
    events = JSON.parse(response) as AWEvent[];
  } catch {
    return null;
  }

  const durationByPath = aggregateUniqueDurationByDataKey(events, "pane_path");
  const paths = Array.from(options.worktreeUrlMap.entries())
    .map(([path, url]) => ({ path: normalizePath(path), url: normalizeCardUrl(url) }))
    .sort((a, b) => b.path.length - a.path.length);
  const selected = new Set(options.labels);
  const totals = new Map<string, number>(options.labels.map((label) => [label, 0]));

  for (const [panePathRaw, seconds] of durationByPath.entries()) {
    const panePath = normalizePath(panePathRaw);
    const mappedUrl = findUrlForPanePath(panePath, paths);
    if (!mappedUrl) {
      continue;
    }
    const state = options.cardStateByUrl.get(mappedUrl);
    if (!state) {
      continue;
    }
    const labelsOnCard = new Set((state.labels ?? []).map((label) => label.toLowerCase()));
    for (const label of labelsOnCard) {
      if (!selected.has(label)) {
        continue;
      }
      totals.set(label, (totals.get(label) ?? 0) + seconds);
    }
  }

  writeJsonFile(pitWallAwCachePath, {
    savedAt: now,
    start,
    bucketId,
    labels: options.labels,
    totals: Object.fromEntries(totals),
  } satisfies PitWallAwCache);

  return totals;
};

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * Math.min(Math.max(p, 0), 1));
  return sorted[index] ?? null;
};

const isWorkday = (date: Date) => {
  const day = date.getDay();
  return day >= 1 && day <= 5;
};

const windowStartForWorkdays = (now: Date, workdays: number) => {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  let remaining = Math.max(0, workdays - 1);
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() - 1);
    if (isWorkday(cursor)) {
      remaining -= 1;
    }
  }
  return cursor.getTime();
};

export const formatDurationCompact = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours}h ${remainingMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
};

export const formatMetricBadge = (options: { kind: "cycle" | "lead" | "none"; ageSeconds: number | null }) => {
  if (options.kind === "none" || options.ageSeconds === null) {
    return defaultBadge;
  }
  const icon = options.kind === "cycle" ? "🛠️" : "⏳";
  const paddedAge = formatDurationCompact(options.ageSeconds).padEnd(6, " ");
  return `[${icon}  ${paddedAge}]`;
};

export const isReviewCardState = (state: CardListState | undefined) =>
  Boolean(state?.labels?.some((label) => label.toLowerCase() === "review"));

export const formatPickerLine = (item: RankedEntry) => {
  const visible = `${item.badge} ${item.label}`;
  const rendered = item.isReviewRequest ? `${reviewLineAnsi}${visible}${ansiReset}` : visible;
  return `${rendered}${delimiter}${item.entry.path}`;
};

const loadWorktreeUrlMapFromSnapshot = (): { map: Map<string, string>; found: boolean } => {
  const sourceSignature = getFileSignature(snapshotsPath);
  const cached = readSignatureCache<Record<string, string>>(
    snapshotWorktreeUrlMapCachePath,
    snapshotsPath,
    sourceSignature,
  );
  if (cached) {
    const map = new Map<string, string>();
    for (const [path, url] of Object.entries(cached)) {
      addWorktreeUrlMapping(map, path, url);
    }
    return { map, found: true };
  }

  const map = new Map<string, string>();
  if (!sourceSignature) {
    return { map, found: false };
  }

  const content = readFileSync(snapshotsPath, "utf8");
  const lines = content.split("\n");
  let lastLine: string | null = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line) {
      lastLine = line;
      break;
    }
  }

  if (!lastLine) {
    writeSignatureCache(snapshotWorktreeUrlMapCachePath, snapshotsPath, sourceSignature, {});
    return { map, found: true };
  }

  try {
    const snapshot = JSON.parse(lastLine) as { worktrees?: { byUrl?: Record<string, string> | null } | null };
    const byUrl = snapshot.worktrees?.byUrl ?? {};
    for (const [url, path] of Object.entries(byUrl)) {
      if (url && path) {
        addWorktreeUrlMapping(map, path, url);
      }
    }
  } catch {
    // Ignore invalid snapshot and fall back to events.
    return { map, found: false };
  }

  writeSignatureCache(snapshotWorktreeUrlMapCachePath, snapshotsPath, sourceSignature, Object.fromEntries(map));
  return { map, found: true };
};

const loadWorktreeUrlMapFromEvents = () => {
  const map = new Map<string, string>();
  const sourceSignature = getFileSignature(eventsPath);
  const cached = readSignatureCache<Record<string, string>>(worktreeUrlMapCachePath, eventsPath, sourceSignature);
  if (cached) {
    const map = new Map<string, string>();
    for (const [path, url] of Object.entries(cached)) {
      addWorktreeUrlMapping(map, path, url);
    }
    return map;
  }

  if (!sourceSignature) {
    return map;
  }

  const content = readFileSync(eventsPath, "utf8");
  for (const line of readLines(content)) {
    try {
      const event = JSON.parse(line) as { type?: string; payload?: { path?: string; url?: string } };
      if (event.type !== "worktree.added") {
        continue;
      }
      const path = event.payload?.path;
      const url = event.payload?.url;
      if (path && url) {
        addWorktreeUrlMapping(map, path, url);
      }
    } catch {
      continue;
    }
  }
  writeSignatureCache(worktreeUrlMapCachePath, eventsPath, sourceSignature, Object.fromEntries(map));
  return map;
};

const loadWorktreeUrlMap = () => {
  const { map: snapshotMap, found } = loadWorktreeUrlMapFromSnapshot();
  const eventsMap = loadWorktreeUrlMapFromEvents();
  if (!found) {
    return eventsMap;
  }
  for (const [path, url] of eventsMap.entries()) {
    if (!snapshotMap.has(path)) {
      snapshotMap.set(path, url);
    }
  }
  return snapshotMap;
};

const loadCardStateByUrl = () => {
  const sourceSignature = getFileSignature(cardStatePath);
  const cached = readSignatureCache<Record<string, CardListState>>(cardStateByUrlCachePath, cardStatePath, sourceSignature);
  if (cached) {
    return new Map(Object.entries(cached));
  }

  const map = new Map<string, CardListState>();
  if (!sourceSignature) {
    return map;
  }

  const content = readFileSync(cardStatePath, "utf8");
  for (const line of readLines(content)) {
    try {
      const parsed = JSON.parse(line) as CardListState;
      if (!parsed.url) {
        continue;
      }
      map.set(normalizeCardUrl(parsed.url), parsed);
    } catch {
      continue;
    }
  }
  writeSignatureCache(cardStateByUrlCachePath, cardStatePath, sourceSignature, Object.fromEntries(map));
  return map;
};

const loadLifecycleData = (): LifecycleData => {
  const sourceSignature = getFileSignature(metricsPath);
  const cached = readSignatureCache<{
    leadStartByCardIdEntries: Array<[string, number]>;
    completedCycles: Array<{ cardId: string; completedAt: number; cycleSeconds: number; label: string | null }>;
    completedCycleByCardIdEntries?: Array<[string, number]>;
    doneEntries?: Array<{ cardId: string; completedAt: number; label: string | null }>;
  }>(lifecycleCachePath, metricsPath, sourceSignature);
  const hasCompatibleCycleEntries = cached?.completedCycles.every((entry) => typeof entry.cardId === "string") ?? false;
  const hasCompatibleDoneEntries = cached?.doneEntries?.every((entry) => typeof entry.cardId === "string") ?? false;
  if (cached?.completedCycleByCardIdEntries && hasCompatibleCycleEntries && hasCompatibleDoneEntries) {
    return {
      leadStartByCardId: new Map(cached.leadStartByCardIdEntries),
      completedCycles: cached.completedCycles,
      completedCycleByCardId: new Map(cached.completedCycleByCardIdEntries),
      doneEntries: cached.doneEntries ?? [],
    };
  }

  const leadStartByCardId = new Map<string, number>();
  const completedCycles: Array<{ cardId: string; completedAt: number; cycleSeconds: number; label: string | null }> = [];
  const completedCycleByCardId = new Map<string, number>();
  const doneEntries: Array<{ cardId: string; completedAt: number; label: string | null }> = [];

  if (!sourceSignature) {
    return { leadStartByCardId, completedCycles, completedCycleByCardId, doneEntries };
  }

  const content = readFileSync(metricsPath, "utf8");
  const lines = content.split("\n").slice(1);
  const doingStartByCardId = new Map<string, number>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let record: ReturnType<typeof parseMetricsRecord>;
    try {
      record = parseMetricsRecord(line);
    } catch {
      continue;
    }

    const ts = parseIso(record.timestamp);
    if (ts === null) {
      continue;
    }
    if (record.eventType === "entered" && record.list === "Ready" && !leadStartByCardId.has(record.cardId)) {
      leadStartByCardId.set(record.cardId, ts);
      continue;
    }
    if (record.eventType === "entered" && record.list === "Doing") {
      doingStartByCardId.set(record.cardId, ts);
      continue;
    }
    if (record.eventType === "entered" && record.list === "Done") {
      doneEntries.push({
        cardId: record.cardId,
        completedAt: ts,
        label: record.label ?? null,
      });
      const doingStart = doingStartByCardId.get(record.cardId);
      if (!doingStart || ts <= doingStart) {
        continue;
      }
      const cycleSeconds = Math.floor((ts - doingStart) / 1000);
      completedCycles.push({ cardId: record.cardId, completedAt: ts, cycleSeconds, label: record.label ?? null });
      if (!completedCycleByCardId.has(record.cardId)) {
        completedCycleByCardId.set(record.cardId, cycleSeconds);
      }
    }
  }

  writeSignatureCache(lifecycleCachePath, metricsPath, sourceSignature, {
    leadStartByCardIdEntries: Array.from(leadStartByCardId.entries()),
    completedCycles,
    completedCycleByCardIdEntries: Array.from(completedCycleByCardId.entries()),
    doneEntries,
  });

  return { leadStartByCardId, completedCycles, completedCycleByCardId, doneEntries };
};

export const buildPitWallHeader = (options: {
  now: Date;
  labels: string[];
  cardStates: CardListState[];
  doneEntries: Array<{ cardId: string; completedAt: number; label: string | null }>;
  completedCycles: Array<{ cardId: string; completedAt: number; cycleSeconds: number; label: string | null }>;
  awSecondsByLabel?: Map<string, number> | null;
}) => {
  const selectedLabels = options.labels.length > 0 ? options.labels : pitWallDefaultLabels;
  const selectedLabelSet = new Set(selectedLabels);
  const throughputWindowStart = options.now.getTime() - pitWallThroughputWindowDays * 24 * 60 * 60 * 1000;
  const throughputByLabel = new Map<string, number>();
  const cycleSamplesByLabel = new Map<string, number[]>();
  const globalCycleSamples: number[] = [];
  for (const label of selectedLabels) {
    cycleSamplesByLabel.set(label, []);
    throughputByLabel.set(label, 0);
  }

  const cardLabelsById = new Map<string, Set<string>>();
  for (const state of options.cardStates) {
    cardLabelsById.set(state.cardId, new Set(state.labels.map((label) => label.toLowerCase())));
  }

  for (const completed of options.completedCycles) {
    const cycleSeconds = completed.cycleSeconds;
    if (!Number.isFinite(cycleSeconds) || cycleSeconds < minCycleSecondsForBest) {
      continue;
    }
    globalCycleSamples.push(cycleSeconds);

    const labelsFromState = cardLabelsById.get(completed.cardId);
    const fallbackLabel = completed.label?.toLowerCase() ?? null;
    const labels = labelsFromState && labelsFromState.size > 0
      ? labelsFromState
      : fallbackLabel
        ? new Set([fallbackLabel])
        : null;
    if (!labels) {
      continue;
    }

    for (const label of labels) {
      if (!selectedLabelSet.has(label)) {
        continue;
      }
      cycleSamplesByLabel.get(label)?.push(cycleSeconds);
    }
  }

  for (const done of options.doneEntries) {
    if (done.completedAt < throughputWindowStart) {
      continue;
    }
    const labelsFromState = cardLabelsById.get(done.cardId);
    const fallbackLabel = done.label?.toLowerCase() ?? null;
    const labels = labelsFromState && labelsFromState.size > 0
      ? labelsFromState
      : fallbackLabel
        ? new Set([fallbackLabel])
        : null;
    if (!labels) {
      continue;
    }
    for (const label of labels) {
      if (!selectedLabelSet.has(label)) {
        continue;
      }
      throughputByLabel.set(label, (throughputByLabel.get(label) ?? 0) + 1);
    }
  }

  const globalP70 = percentile(globalCycleSamples, pitWallCyclePercentile) ?? pitWallFallbackCycleSeconds;
  const globalBest = globalCycleSamples.length > 0 ? Math.min(...globalCycleSamples) : null;
  const labelWidth = selectedLabels.reduce((max, label) => Math.max(max, label.length), 0);

  const lines = selectedLabels.map((label) => {
    const cycleSamples = cycleSamplesByLabel.get(label) ?? [];
    const labelP70 = cycleSamples.length >= pitWallLabelMinSamples
      ? percentile(cycleSamples, pitWallCyclePercentile) ?? globalP70
      : globalP70;
    const labelBest = cycleSamples.length > 0 ? Math.min(...cycleSamples) : globalBest;
    const throughput = throughputByLabel.get(label) ?? 0;
    const p70Text = formatDurationCompact(labelP70);
    const bestText = labelBest === null ? "--" : formatDurationCompact(labelBest);
    const awSeconds = options.awSecondsByLabel?.get(label);
    const awText = awSeconds === undefined || awSeconds === null ? "--" : formatDurationCompact(Math.floor(awSeconds));
    return `${label.padEnd(labelWidth, " ")} 🏁 ${throughput.toString().padStart(2, " ")}/${pitWallThroughputWindowDays}d ⏱ p70 ${p70Text} 🥇 ${bestText} 🕒 ${awText}`;
  });

  return lines.join("\n");
};

export const buildHeader = (options: {
  now: Date;
  oldestDoingAgeSeconds: number | null;
  completedCycles: Array<{ completedAt: number; cycleSeconds: number }>;
}) => {
  const focusText = options.oldestDoingAgeSeconds === null
    ? "none"
    : formatDurationCompact(options.oldestDoingAgeSeconds);
  const windowStart = windowStartForWorkdays(options.now, headerWindowWorkdays);
  const candidates = options.completedCycles
    .filter((entry) => {
      if (entry.completedAt < windowStart) {
        return false;
      }
      return isWorkday(new Date(entry.completedAt));
    })
    .map((entry) => entry.cycleSeconds)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  const meaningfulCandidates = candidates.filter((seconds) => seconds >= minCycleSecondsForBest);
  const bestPool = meaningfulCandidates.length > 0 ? meaningfulCandidates : candidates;
  const best = bestPool.length > 0 ? Math.min(...bestPool) : null;
  const bestText = best === null ? "--" : formatDurationCompact(best);
  return [
    `🎯 Focus: Oldest Doing = ${focusText}`,
    `🏆 Best (last ${headerWindowWorkdays} workdays): ${bestText}`,
  ].join("\n");
};

export const classifyGhqEntry = (options: {
  entryPath: string;
  ghqRoot?: string;
  includeRepos?: boolean;
  worktreeUrlMap?: Map<string, string>;
  existsPath?: (path: string) => boolean;
}): Entry | null => {
  const ghqRoot = options.ghqRoot ?? join(homedir(), "ghq");
  const normalized = normalizePath(options.entryPath);
  const rel = relative(ghqRoot, normalized).split("/");
  const host = rel[0] ?? null;
  const owner = rel[1] ?? null;
  const repoSegment = rel[2] ?? null;
  if (!host || !owner || !repoSegment) {
    return null;
  }
  const separatorIndex = repoSegment.indexOf("=");
  if (separatorIndex > 0) {
    const repo = repoSegment.slice(0, separatorIndex) || null;
    const leaf = repoSegment.slice(separatorIndex + 1) || null;
    return {
      path: normalized,
      kind: "worktree",
      url: options.worktreeUrlMap?.get(normalized) ?? null,
      host,
      owner,
      repo,
      leaf,
    };
  }
  if (options.includeRepos === false) {
    return null;
  }

  const existsPath = options.existsPath ?? existsSync;
  let leaf: string | null = null;
  if (existsPath(join(normalized, ".git/refs/heads/main"))) {
    leaf = "main";
  } else if (existsPath(join(normalized, ".git/refs/heads/master"))) {
    leaf = "master";
  }
  return {
    path: normalized,
    kind: "repo",
    host,
    owner,
    repo: repoSegment,
    leaf,
  };
};

export const gatherEntries = () => {
  const entries: Entry[] = [];
  const worktreeUrlMap = loadWorktreeUrlMap();

  const ghqRoot = join(homedir(), "ghq");
  const loadDirCache = (name: string, root: string, depth: number, minDepth: number) => {
    if (!existsSync(root)) {
      return [] as string[];
    }
    const cachePath = join(stateDir, `${name}-dir-cache.json`);
    const cached = readJsonFile<{ root?: string; rootMtimeMs?: number; savedAt?: number; dirs?: string[] }>(cachePath);
    const rootStats = statSync(root);
    const isFresh =
      cached?.root === root &&
      cached.rootMtimeMs === rootStats.mtimeMs &&
      cached.savedAt &&
      Date.now() - cached.savedAt < dirCacheTtlMs &&
      Array.isArray(cached.dirs);
    if (isFresh && cached.dirs) {
      return cached.dirs;
    }
    const dirs = readLines(runOptional("fd", ["-d", `${depth}`, "--min-depth", `${minDepth}`, "-t", "d", ".", root]))
      .map((path) => path.trim());
    writeJsonFile(cachePath, {
      root,
      rootMtimeMs: rootStats.mtimeMs,
      savedAt: Date.now(),
      dirs,
    });
    return dirs;
  };
  const ghqDirs = loadDirCache("ghq", ghqRoot, 3, 3);
  for (const path of ghqDirs) {
    if (!path) {
      continue;
    }
    const entry = classifyGhqEntry({
      entryPath: path,
      ghqRoot,
      includeRepos,
      worktreeUrlMap,
    });
    if (!entry) {
      continue;
    }
    entries.push(entry);
  }

  return entries;
};

const rankEntries = (entries: Entry[]) => {
  const now = Date.now();
  const cardStateByUrl = loadCardStateByUrl();
  const worktreeUrlMap = loadWorktreeUrlMap();
  const pitWallLabels = parsePitWallLabels();
  const { leadStartByCardId, completedCycles, doneEntries } = loadLifecycleData();
  const allCardStates = Array.from(cardStateByUrl.values());
  const awSecondsByLabel = loadPitWallAwSecondsByLabel({
    labels: pitWallLabels,
    cardStateByUrl,
    worktreeUrlMap,
  });

  const ranked: RankedEntry[] = entries.map((entry) => {
    const label = entry.kind === "worktree" ? formatWorktreeLabel(entry) : formatRepoLabel(entry);
    if (entry.kind === "repo") {
      return { entry, category: 3, ageSeconds: null, label, badge: defaultBadge, isReviewRequest: false };
    }

    const normalizedUrl = entry.url ? normalizeCardUrl(entry.url) : null;
    const cardState = normalizedUrl ? cardStateByUrl.get(normalizedUrl) : undefined;
    const isReviewRequest = isReviewCardState(cardState);
    if (!cardState) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge, isReviewRequest };
    }

    const enteredAtTs = parseIso(cardState.enteredAt);
    if (enteredAtTs === null) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge, isReviewRequest };
    }

    const enteredAge = Math.max(0, Math.floor((now - enteredAtTs) / 1000));
    if (cardState.list === "Doing") {
      return {
        entry,
        category: 0,
        ageSeconds: enteredAge,
        label,
        badge: formatMetricBadge({ kind: "cycle", ageSeconds: enteredAge }),
        isReviewRequest,
      };
    }

    if (cardState.list === "Ready") {
      const leadStartTs = leadStartByCardId.get(cardState.cardId) ?? enteredAtTs;
      const leadAge = Math.max(0, Math.floor((now - leadStartTs) / 1000));
      return {
        entry,
        category: 1,
        ageSeconds: enteredAge,
        label,
        badge: formatMetricBadge({ kind: "lead", ageSeconds: leadAge }),
        isReviewRequest,
      };
    }

    const leadStartTs = leadStartByCardId.get(cardState.cardId);
    if (leadStartTs === undefined) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge, isReviewRequest };
    }
    const leadAge = Math.max(0, Math.floor((now - leadStartTs) / 1000));
    return {
      entry,
      category: 2,
      ageSeconds: null,
      label,
      badge: formatMetricBadge({ kind: "lead", ageSeconds: leadAge }),
      isReviewRequest,
    };
  });

  ranked.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category - b.category;
    }
    const ageA = a.ageSeconds ?? -1;
    const ageB = b.ageSeconds ?? -1;
    if ((a.category === 0 || a.category === 1) && ageA !== ageB) {
      return ageB - ageA;
    }
    return a.label.localeCompare(b.label);
  });

  return {
    ranked,
    header: buildPitWallHeader({
      now: new Date(now),
      labels: pitWallLabels,
      cardStates: allCardStates,
      doneEntries,
      completedCycles,
      awSecondsByLabel,
    }),
  };
};

const pickEntry = (entries: Entry[]) => {
  const { ranked, header } = rankEntries(entries);
  if (ranked.length === 0) {
    return null;
  }
  const lines = ranked.map(formatPickerLine);
  const selected = runOptional(
    "fzf",
    ["--ansi", "--delimiter", delimiter, "--with-nth", "1", "--header", header],
    lines.join("\n"),
    { ...process.env, PATH: ensureFzfPath() },
  );
  const chosenLine = selected.trim();
  if (!chosenLine) {
    return null;
  }
  const parts = chosenLine.split(delimiter);
  return parts[1] ?? null;
};

export const main = () => {
  const selectedPath = argPath ?? pickEntry(gatherEntries());
  if (!selectedPath) {
    process.exit(0);
  }

  const sessionName = pathToSessionName(selectedPath);
  debugLog(`selectedPath=${selectedPath} sessionName=${sessionName}`);
  if (dryRun) {
    console.log(`${selectedPath} -> ${sessionName}`);
    process.exit(0);
  }

  const tmuxRunning = runOptional("pgrep", ["tmux"]);
  if (!process.env.TMUX && !tmuxRunning.trim()) {
    run("tmux", ["new-session", "-s", sessionName, "-c", selectedPath]);
    run("tmux", ["split-window", "-h", "-t", sessionName]);
    run("tmux", ["resize-pane", "-t", sessionName, "-x", "92"]);
    process.exit(0);
  }

  let sessionId = resolveSessionIdByName(sessionName);
  if (!sessionId) {
    debugLog(`session missing, creating name=${sessionName}`);
    run("tmux", ["new-session", "-ds", sessionName, "-c", selectedPath]);
    sessionId = resolveSessionIdByName(sessionName);
    const createdTarget = sessionId ?? `=${sessionName}`;
    run("tmux", ["send-keys", "-t", createdTarget, "vim", "C-m"]);
    ensureSessionLayout(createdTarget, selectedPath);
  }

  const sessionTarget = sessionId ?? `=${sessionName}`;
  debugLog(`sessionTarget=${sessionTarget}`);
  ensureSessionLayout(sessionTarget, selectedPath);

  if (!process.env.TMUX) {
    run("tmux", ["attach", "-t", sessionTarget]);
  } else {
    run("tmux", ["switch-client", "-t", sessionTarget]);
  }
};

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMainModule) {
  main();
}
