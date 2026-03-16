#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMetricsRecord } from "../lib/metrics/types";

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
  url: string | null;
};

type LifecycleData = {
  leadStartByCardId: Map<string, number>;
  completedCycles: Array<{ completedAt: number; cycleSeconds: number }>;
};

type RankedEntry = {
  entry: Entry;
  category: number;
  ageSeconds: number | null;
  label: string;
  badge: string;
};

const delimiter = "\u001f";
const defaultBadge = "[·   --    ]";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const stateDir = join(repoRoot, "scripts/wo/state");
const eventsPath = join(stateDir, "wo-events.jsonl");
const cardStatePath = join(stateDir, "wo-card-states.jsonl");
const metricsPath = join(stateDir, "wo-metrics.csv");
const dirCacheTtlMs = 30_000;
const headerWindowWorkdays = 30;

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

const pathToSessionName = (path: string) => {
  const home = homedir();
  const rel = path.startsWith(home) ? relative(home, path) : path;
  return rel.replace(/[/.]/g, "_");
};

const normalizePath = (value: string) => value.replace(/\/+$/, "");
const normalizeCardUrl = (value: string) => value.trim().replace(/\/+$/, "");

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

const loadWorktreeUrlMap = () => {
  const map = new Map<string, string>();
  if (!existsSync(eventsPath)) {
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
        map.set(normalizePath(path), normalizeCardUrl(url));
      }
    } catch {
      continue;
    }
  }
  return map;
};

const loadCardStateByUrl = () => {
  const map = new Map<string, CardListState>();
  if (!existsSync(cardStatePath)) {
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
  return map;
};

const loadLifecycleData = (): LifecycleData => {
  const leadStartByCardId = new Map<string, number>();
  const completedCycles: Array<{ completedAt: number; cycleSeconds: number }> = [];

  if (!existsSync(metricsPath)) {
    return { leadStartByCardId, completedCycles };
  }

  const content = readFileSync(metricsPath, "utf8");
  const lines = content.split("\n").slice(1).map((line) => line.trim()).filter(Boolean);
  const records = lines
    .map((line) => {
      try {
        return parseMetricsRecord(line);
      } catch {
        return null;
      }
    })
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const doingStartByCardId = new Map<string, number>();
  for (const record of records) {
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
      const doingStart = doingStartByCardId.get(record.cardId);
      if (!doingStart || ts <= doingStart) {
        continue;
      }
      const cycleSeconds = Math.floor((ts - doingStart) / 1000);
      completedCycles.push({ completedAt: ts, cycleSeconds });
    }
  }

  return { leadStartByCardId, completedCycles };
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
  const best = candidates.length > 0 ? Math.min(...candidates) : null;
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
  const { leadStartByCardId, completedCycles } = loadLifecycleData();

  const ranked: RankedEntry[] = entries.map((entry) => {
    const label = entry.kind === "worktree" ? formatWorktreeLabel(entry) : formatRepoLabel(entry);
    if (entry.kind === "repo") {
      return { entry, category: 3, ageSeconds: null, label, badge: defaultBadge };
    }

    const normalizedUrl = entry.url ? normalizeCardUrl(entry.url) : null;
    const cardState = normalizedUrl ? cardStateByUrl.get(normalizedUrl) : undefined;
    if (!cardState) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge };
    }

    const enteredAtTs = parseIso(cardState.enteredAt);
    if (enteredAtTs === null) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge };
    }

    const enteredAge = Math.max(0, Math.floor((now - enteredAtTs) / 1000));
    if (cardState.list === "Doing") {
      return {
        entry,
        category: 0,
        ageSeconds: enteredAge,
        label,
        badge: formatMetricBadge({ kind: "cycle", ageSeconds: enteredAge }),
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
      };
    }

    const leadStartTs = leadStartByCardId.get(cardState.cardId);
    if (leadStartTs === undefined) {
      return { entry, category: 2, ageSeconds: null, label, badge: defaultBadge };
    }
    const leadAge = Math.max(0, Math.floor((now - leadStartTs) / 1000));
    return {
      entry,
      category: 2,
      ageSeconds: null,
      label,
      badge: formatMetricBadge({ kind: "lead", ageSeconds: leadAge }),
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

  const oldestDoingAgeSeconds = ranked
    .filter((item) => item.category === 0 && item.ageSeconds !== null)
    .reduce<number | null>((oldest, current) => {
      if (current.ageSeconds === null) {
        return oldest;
      }
      if (oldest === null || current.ageSeconds > oldest) {
        return current.ageSeconds;
      }
      return oldest;
    }, null);

  return {
    ranked,
    header: buildHeader({ now: new Date(now), oldestDoingAgeSeconds, completedCycles }),
  };
};

const pickEntry = (entries: Entry[]) => {
  const { ranked, header } = rankEntries(entries);
  if (ranked.length === 0) {
    return null;
  }
  const lines = ranked.map((item) => `${item.badge} ${item.label}${delimiter}${item.entry.path}`);
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
