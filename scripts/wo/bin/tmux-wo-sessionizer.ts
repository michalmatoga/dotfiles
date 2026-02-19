#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

type EntryKind = "worktree" | "repo";

type Entry = {
  path: string;
  kind: EntryKind;
  url?: string | null;
  title?: string | null;
  host?: string | null;
  owner?: string | null;
  repo?: string | null;
  leaf?: string | null;
};

const delimiter = "\u001f";

const scriptDir = __dirname;
const repoRoot = join(scriptDir, "../../..");
const stateDir = join(repoRoot, "scripts/wo/state");
const eventsPath = join(stateDir, "wo-events.jsonl");
const opencodeLogDir = join(homedir(), ".local/share/opencode/log");
const recentLogCount = 5;
const opencodeDbCacheTtlMs = 10_000;
const dirCacheTtlMs = 30_000;

const args = process.argv.slice(2);
const argPath = args.find((arg) => !arg.startsWith("--")) ?? null;
const includeGhq = !args.includes("--gwq-only");
const dryRun = args.includes("--dry-run");
const paneDelimiter = "\t";

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

const runOptional = (
  command: string,
  commandArgs: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
) => {
  try {
    return run(command, commandArgs, { input, env });
  } catch {
    return "";
  }
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

const formatPathSegments = (segments: Array<string | null>) =>
  segments.filter((value): value is string => Boolean(value)).join(" › ");

const formatRepoLabel = (entry: Entry) => {
  const label = formatPathSegments([entry.host, entry.owner, entry.repo]);
  return label || entry.path;
};

const formatWorktreeLabel = (entry: Entry) => {
  const label = formatPathSegments([entry.host, entry.owner, entry.repo, entry.leaf]);
  return label || entry.path;
};

const loadWorktreeUrlMap = () => {
  if (!existsSync(eventsPath)) {
    return new Map<string, string>();
  }
  const map = new Map<string, string>();
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
        map.set(normalizePath(path), url);
      }
    } catch {
      continue;
    }
  }
  return map;
};

const loadOpencodeSessionsFromEvents = () => {
  const map = new Map<string, { sessionId: string; ts: number }>();
  if (!existsSync(eventsPath)) {
    return map;
  }
  const content = readFileSync(eventsPath, "utf8");
  for (const line of readLines(content)) {
    try {
      const event = JSON.parse(line) as {
        ts?: string;
        type?: string;
        payload?: { worktreePath?: string; sessionId?: string | null };
      };
      if (event.type !== "opencode.session.created") {
        continue;
      }
      const worktreePath = event.payload?.worktreePath;
      const sessionId = event.payload?.sessionId ?? null;
      if (!worktreePath || !sessionId) {
        continue;
      }
      const ts = event.ts ? new Date(event.ts).getTime() : 0;
      const current = map.get(worktreePath);
      if (!current || ts >= current.ts) {
        map.set(worktreePath, { sessionId, ts });
      }
    } catch {
      continue;
    }
  }
  return map;
};

const loadOpencodeSessionsFromDb = () => {
  const map = new Map<string, { sessionId: string; ts: number }>();
  const cachePath = join(stateDir, "opencode-db-cache.json");
  const cached = readJsonFile<{
    savedAt?: number;
    rows?: Array<{ id?: string; directory?: string; time_updated?: number }>;
  }>(cachePath);
  if (cached?.savedAt && cached.rows && Date.now() - cached.savedAt < opencodeDbCacheTtlMs) {
    for (const row of cached.rows) {
      if (!row.id || !row.directory) {
        continue;
      }
      const ts = row.time_updated ?? 0;
      const normalized = normalizePath(row.directory);
      const current = map.get(normalized);
      if (!current || ts >= current.ts) {
        map.set(normalized, { sessionId: row.id, ts });
      }
    }
    return map;
  }
  const gwqRoot = normalizePath(join(homedir(), "gwq"));
  const query = `select id, directory, time_updated from session where directory like '${gwqRoot.replace(/'/g, "''")}/%';`;
  const raw = runOptional("opencode", ["db", "--format", "json", query]);
  if (!raw) {
    return map;
  }
  try {
    const rows = JSON.parse(raw) as Array<{ id?: string; directory?: string; time_updated?: number }>;
    for (const row of rows) {
      if (!row.id || !row.directory) {
        continue;
      }
      const ts = row.time_updated ?? 0;
      const normalized = normalizePath(row.directory);
      const current = map.get(normalized);
      if (!current || ts >= current.ts) {
        map.set(normalized, { sessionId: row.id, ts });
      }
    }
    writeJsonFile(cachePath, { savedAt: Date.now(), rows });
  } catch {
    return map;
  }
  return map;
};

const getRecentLogFiles = () => {
  if (!existsSync(opencodeLogDir)) {
    return [];
  }
  const entries = readdirSync(opencodeLogDir)
    .filter((name) => name.endsWith(".log"))
    .sort();
  const recent = entries.slice(-recentLogCount);
  return recent.map((name) => join(opencodeLogDir, name));
};

const extractSessionId = (line: string): string | null => {
  const match = line.match(/sessionID=([A-Za-z0-9_-]+)/);
  if (match) {
    return match[1] ?? null;
  }
  const idMatch = line.match(/\bid=(ses_[A-Za-z0-9_-]+)/);
  return idMatch ? idMatch[1] : null;
};

const extractSessionIdFromCommand = (command: string): string | null => {
  const match = command.match(/\bopencode\b[^\n]*\s(?:-s|--session)\s+([^\s]+)/);
  return match ? match[1] ?? null : null;
};

const extractDirectory = (line: string): string | null => {
  const match = line.match(/\bdirectory=([^\s]+)/);
  return match ? match[1] : null;
};

const opencodeInternalRunPrefix = join(homedir(), ".local/share/opencode/bin/");
const ignoredOpencodeChildPatterns = [
  opencodeInternalRunPrefix,
  "typescript-language-server",
  "bash-language-server",
  "eslintServer.js",
  "language-server",
  "tsserver.js",
  "typingsInstaller.js",
  "marksman",
  "node_modules/typescript",
  "--stdio",
];

const isInteractiveOpencodeCommand = (command: string) => {
  const runMatch = command.match(/\bopencode\b\s+run\s+(.+)$/);
  if (runMatch) {
    const arg = runMatch[1]?.trim() ?? "";
    return !arg.startsWith(opencodeInternalRunPrefix);
  }
  return /\bopencode\b\s+(?:-s|--session)\b/.test(command);
};

const isIgnoredOpencodeChildCommand = (command: string) =>
  ignoredOpencodeChildPatterns.some((pattern) => command.includes(pattern));

const isActiveOpencodeChildCommand = (command: string) => !isIgnoredOpencodeChildCommand(command);

const isIdleLine = (line: string) =>
  line.includes("type=session.idle") ||
  (line.includes("session.prompt") && (line.includes("exiting loop") || line.includes("cancel")));

const isActiveLine = (line: string) =>
  line.includes("session.prompt") && !line.includes("exiting loop") && !line.includes("cancel");

const loadOpencodeLogState = () => {
  const statusBySession = new Map<string, "idle" | "active">();
  const sessionByPath = new Map<string, string>();
  const logFiles = getRecentLogFiles();
  if (logFiles.length === 0) {
    return { statusBySession, sessionByPath };
  }
  const cachePath = join(stateDir, "opencode-log-cache.json");
  const cached = readJsonFile<{
    files?: Record<string, { mtimeMs: number; size: number; offset: number; lastSessionId?: string | null }>;
    statusBySession?: Record<string, "idle" | "active">;
    sessionByPath?: Record<string, string>;
  }>(cachePath);
  const cachedFiles = cached?.files ?? null;
  let canUseCache = Boolean(cachedFiles) && logFiles.length > 0;
  if (cachedFiles && logFiles.length !== Object.keys(cachedFiles).length) {
    canUseCache = false;
  }
  if (cached?.statusBySession) {
    for (const [sessionId, state] of Object.entries(cached.statusBySession)) {
      statusBySession.set(sessionId, state);
    }
  }
  if (cached?.sessionByPath) {
    for (const [path, sessionId] of Object.entries(cached.sessionByPath)) {
      sessionByPath.set(path, sessionId);
    }
  }

  const nextFiles: Record<string, { mtimeMs: number; size: number; offset: number; lastSessionId?: string | null }> = {};

  for (const logFile of logFiles) {
    const stats = statSync(logFile);
    const cachedEntry = cachedFiles?.[logFile];
    if (!cachedEntry) {
      canUseCache = false;
    }
    if (cachedEntry && (stats.mtimeMs < cachedEntry.mtimeMs || stats.size < cachedEntry.offset)) {
      canUseCache = false;
    }
  }

  for (const logFile of logFiles) {
    const stats = statSync(logFile);
    const cachedEntry = cachedFiles?.[logFile];
    const shouldUseCache = canUseCache && cachedEntry;
    const startOffset = shouldUseCache ? cachedEntry.offset : 0;
    let lastSessionId = (shouldUseCache ? cachedEntry.lastSessionId : null) ?? null;
    let content = "";
    if (stats.size > startOffset) {
      const fd = openSync(logFile, "r");
      try {
        const toRead = stats.size - startOffset;
        const buffer = Buffer.alloc(toRead);
        const bytes = readSync(fd, buffer, 0, toRead, startOffset);
        content = buffer.subarray(0, bytes).toString("utf8");
      } finally {
        closeSync(fd);
      }
    }
    if (!content && !shouldUseCache) {
      content = readFileSync(logFile, "utf8");
    }
    for (const line of readLines(content)) {
      const sessionId = extractSessionId(line);
      const directory = extractDirectory(line);
      if (sessionId) {
        lastSessionId = sessionId;
      }
      if (sessionId && directory) {
        sessionByPath.set(normalizePath(directory), sessionId);
      }
      if (isIdleLine(line)) {
        const target = sessionId ?? lastSessionId;
        if (target) {
          statusBySession.set(target, "idle");
        }
        continue;
      }
      if (sessionId && isActiveLine(line)) {
        statusBySession.set(sessionId, "active");
      }
    }
    nextFiles[logFile] = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      offset: stats.size,
      lastSessionId,
    };
  }

  writeJsonFile(cachePath, {
    files: nextFiles,
    statusBySession: Object.fromEntries(statusBySession.entries()),
    sessionByPath: Object.fromEntries(sessionByPath.entries()),
  });

  return { statusBySession, sessionByPath };
};

const loadOpencodeSessionsFromTmux = () => {
  const sessionByPath = new Map<string, string>();
  const runningPaths = new Set<string>();
  const paneOutput = runOptional("tmux", [
    "list-panes",
    "-a",
    "-F",
    `#{pane_pid}${paneDelimiter}#{pane_current_path}`,
  ]);
  if (!paneOutput) {
    return { sessionByPath, runningPaths };
  }
  const panes: Array<{ pid: number; path: string }> = [];
  for (const line of readLines(paneOutput)) {
    const [pid, path] = line.split(paneDelimiter);
    if (!pid || !path) {
      continue;
    }
    const pidNumber = Number(pid);
    if (!Number.isFinite(pidNumber)) {
      continue;
    }
    panes.push({ pid: pidNumber, path: normalizePath(path) });
  }
  if (panes.length === 0) {
    return { sessionByPath, runningPaths };
  }
  const processOutput = runOptional("ps", ["-eo", "pid=,ppid=,command="]).trim();
  if (!processOutput) {
    return { sessionByPath, runningPaths };
  }
  const processMap = new Map<number, { ppid: number; command: string }>();
  for (const line of readLines(processOutput)) {
    const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3] ?? "";
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue;
    }
    processMap.set(pid, { ppid, command });
  }
  const paneByPid = new Map<number, string>();
  for (const pane of panes) {
    paneByPid.set(pane.pid, pane.path);
  }
  const paneCache = new Map<number, string | null>();
  const paneStatus = new Map<string, { hasOpencode: boolean; hasActive: boolean }>();
  const opencodePidsByPane = new Map<string, Set<number>>();
  const resolvePanePath = (pid: number) => {
    if (paneCache.has(pid)) {
      return paneCache.get(pid) ?? null;
    }
    let current = pid;
    let guard = 0;
    while (processMap.has(current) && guard < 200) {
      const panePath = paneByPid.get(current);
      if (panePath) {
        paneCache.set(pid, panePath);
        return panePath;
      }
      const parent = processMap.get(current)?.ppid ?? 0;
      if (parent <= 1 || parent === current) {
        break;
      }
      current = parent;
      guard += 1;
    }
    paneCache.set(pid, null);
    return null;
  };
  for (const [pid, data] of processMap.entries()) {
    const panePath = resolvePanePath(pid);
    if (!panePath) {
      continue;
    }
    if (!data.command.includes("opencode")) {
      continue;
    }
    const status = paneStatus.get(panePath) ?? { hasOpencode: false, hasActive: false };
    status.hasOpencode = true;
    if (isInteractiveOpencodeCommand(data.command)) {
      status.hasActive = true;
    }
    const sessionId = extractSessionIdFromCommand(data.command);
    if (sessionId) {
      sessionByPath.set(panePath, sessionId);
    }
    const opencodePids = opencodePidsByPane.get(panePath) ?? new Set<number>();
    opencodePids.add(pid);
    opencodePidsByPane.set(panePath, opencodePids);
    paneStatus.set(panePath, status);
  }
  const descendantCache = new Map<string, boolean>();
  const isDescendantOf = (pid: number, ancestors: Set<number>) => {
    const cacheKey = `${pid}:${[...ancestors].join(",")}`;
    if (descendantCache.has(cacheKey)) {
      return descendantCache.get(cacheKey) ?? false;
    }
    let current = pid;
    let guard = 0;
    while (processMap.has(current) && guard < 200) {
      const parent = processMap.get(current)?.ppid ?? 0;
      if (ancestors.has(parent)) {
        descendantCache.set(cacheKey, true);
        return true;
      }
      if (parent <= 1 || parent === current) {
        break;
      }
      current = parent;
      guard += 1;
    }
    descendantCache.set(cacheKey, false);
    return false;
  };
  for (const [pid, data] of processMap.entries()) {
    if (data.command.includes("opencode")) {
      continue;
    }
    const panePath = resolvePanePath(pid);
    if (!panePath) {
      continue;
    }
    const opencodePids = opencodePidsByPane.get(panePath);
    if (!opencodePids || opencodePids.size === 0) {
      continue;
    }
    if (!isDescendantOf(pid, opencodePids)) {
      continue;
    }
    if (!isActiveOpencodeChildCommand(data.command)) {
      continue;
    }
    const status = paneStatus.get(panePath) ?? { hasOpencode: true, hasActive: false };
    status.hasActive = true;
    paneStatus.set(panePath, status);
  }
  for (const [path, status] of paneStatus.entries()) {
    if (status.hasOpencode && status.hasActive) {
      runningPaths.add(path);
    }
  }
  return { sessionByPath, runningPaths };
};

const ensureFzfPath = () => {
  const fzfDir = join(homedir(), ".fzf", "bin");
  const current = process.env.PATH ?? "";
  if (current.split(":").includes(fzfDir)) {
    return current;
  }
  return `${fzfDir}:${current}`;
};

const gatherEntries = () => {
  const entries: Entry[] = [];
  const worktreeUrlMap = loadWorktreeUrlMap();

  const gwqRoot = join(homedir(), "gwq");
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
  const gwqDirs = loadDirCache("gwq", gwqRoot, 4, 4);
  for (const path of gwqDirs) {
    if (!path) {
      continue;
    }
    const normalized = normalizePath(path);
    const rel = relative(gwqRoot, normalized).split("/");
    entries.push({
      path: normalized,
      kind: "worktree",
      url: worktreeUrlMap.get(normalized) ?? null,
      host: rel[0] ?? null,
      owner: rel[1] ?? null,
      repo: rel[2] ?? null,
      leaf: rel.slice(3).join("/") || null,
    });
  }

  if (includeGhq) {
    const ghqDirs = loadDirCache("ghq", ghqRoot, 3, 3);
    for (const path of ghqDirs) {
      if (!path) {
        continue;
      }
      const normalized = normalizePath(path);
      const rel = relative(ghqRoot, normalized).split("/");
      let leaf: string | null = null;
      if (existsSync(join(normalized, ".git/refs/heads/main"))) {
        leaf = "main";
      } else if (existsSync(join(normalized, ".git/refs/heads/master"))) {
        leaf = "master";
      }
      entries.push({
        path: normalized,
        kind: "repo",
        host: rel[0] ?? null,
        owner: rel[1] ?? null,
        repo: rel[2] ?? null,
        leaf,
      });
    }
  }

  return entries;
};

const formatEntry = (
  entry: Entry,
  sessionIdByPath: Map<string, string>,
  statusBySession: Map<string, "idle" | "active">,
  runningSessions: Set<string>,
  runningPaths: Set<string>,
): { line: string; rank: number; label: string } => {
  const sessionId = sessionIdByPath.get(normalizePath(entry.path)) ?? null;
  const status = sessionId ? statusBySession.get(sessionId) : null;
  const isActive =
    status === "active" ||
    (status === undefined && sessionId && runningSessions.has(sessionId)) ||
    runningPaths.has(normalizePath(entry.path));
  const hasSession = Boolean(sessionId);
  const dot = isActive ? "●" : hasSession ? "◐" : "○";
  const label = `${dot} ${formatWorktreeLabel(entry)}`;
  const rank = hasSession ? (isActive ? 1 : 0) : 2;
  return { line: `${label}${delimiter}${entry.path}`, rank, label };
};

const pickEntry = (entries: Entry[]) => {
  const dbSessions = loadOpencodeSessionsFromDb();
  const opencodeSessionMap = loadOpencodeSessionsFromEvents();
  const { statusBySession, sessionByPath: logSessionByPath } = loadOpencodeLogState();
  const { sessionByPath: tmuxSessionByPath, runningPaths } = loadOpencodeSessionsFromTmux();
  const sessionIdByPath = new Map<string, string>();
  for (const [path, data] of dbSessions.entries()) {
    sessionIdByPath.set(normalizePath(path), data.sessionId);
  }
  for (const [path, data] of opencodeSessionMap.entries()) {
    if (!sessionIdByPath.has(path)) {
      sessionIdByPath.set(normalizePath(path), data.sessionId);
    }
  }
  for (const [path, sessionId] of logSessionByPath.entries()) {
    if (!sessionIdByPath.has(path)) {
      sessionIdByPath.set(path, sessionId);
    }
  }
  for (const [path, sessionId] of tmuxSessionByPath.entries()) {
    sessionIdByPath.set(path, sessionId);
  }

  const runningSessions = new Set(tmuxSessionByPath.values());

  const lines = entries
    .map((entry) => formatEntry(entry, sessionIdByPath, statusBySession, runningSessions, runningPaths))
    .sort((a, b) => (a.rank === b.rank ? a.label.localeCompare(b.label) : a.rank - b.rank))
    .map((item) => item.line);
  if (lines.length === 0) {
    return null;
  }
  const selected = runOptional(
    "fzf",
    ["--ansi", "--delimiter", delimiter, "--with-nth", "1"],
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

const selectedPath = argPath ?? pickEntry(gatherEntries());
if (!selectedPath) {
  process.exit(0);
}

const sessionName = pathToSessionName(selectedPath);
if (dryRun) {
  console.log(`${selectedPath} -> ${sessionName}`);
  process.exit(0);
}

const tmuxRunning = runOptional("pgrep", ["tmux"]);
if (!process.env.TMUX && !tmuxRunning.trim()) {
  run("tmux", ["new-session", "-s", sessionName, "-c", selectedPath]);
  run("tmux", ["split-window", "-h", "-t", sessionName]);
  run("tmux", ["resize-pane", "-t", sessionName, "-x", "70"]);
  process.exit(0);
}

try {
  run("tmux", ["has-session", "-t", sessionName]);
} catch {
  run("tmux", ["new-session", "-ds", sessionName, "-c", selectedPath]);
  run("tmux", ["send-keys", "-t", sessionName, "vim", "C-m"]);
  run("tmux", ["split-window", "-h", "-t", sessionName, "-c", selectedPath]);
  run("tmux", ["resize-pane", "-t", sessionName, "-x", "70"]);
}

if (!process.env.TMUX) {
  run("tmux", ["attach", "-t", sessionName]);
} else {
  run("tmux", ["switch-client", "-t", sessionName]);
}
