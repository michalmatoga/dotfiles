#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

type EntryKind = "worktree" | "repo";

type Entry = {
  path: string;
  kind: EntryKind;
  url?: string | null;
  title?: string | null;
};

type CacheEntry = {
  title: string;
  ts: string;
};

type CacheFile = Record<string, CacheEntry>;

const delimiter = "\u001f";
const cacheTtlMs = 24 * 60 * 60 * 1000;

const scriptDir = __dirname;
const repoRoot = join(scriptDir, "../../..");
const stateDir = join(repoRoot, "scripts/wo/state");
const cachePath = join(stateDir, "wo-sessionizer-cache.json");
const eventsPath = join(stateDir, "wf-events.jsonl");

const args = process.argv.slice(2);
const argPath = args.find((arg) => !arg.startsWith("--")) ?? null;
const includeGhq = !args.includes("--gwq-only");
const noTitle = args.includes("--no-title");
const dryRun = args.includes("--dry-run");

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

const runOptional = (command: string, commandArgs: string[]) => {
  try {
    return run(command, commandArgs);
  } catch {
    return "";
  }
};

const readLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const pathToSessionName = (path: string) => {
  const home = homedir();
  const rel = path.startsWith(home) ? relative(home, path) : path;
  return rel.replace(/[/.]/g, "_");
};

const loadCache = (): CacheFile => {
  if (!existsSync(cachePath)) {
    return {};
  }
  try {
    const content = readFileSync(cachePath, "utf8");
    return JSON.parse(content) as CacheFile;
  } catch {
    return {};
  }
};

const saveCache = (cache: CacheFile) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
};

const isCacheFresh = (entry: CacheEntry) => {
  const ts = new Date(entry.ts).getTime();
  return Number.isFinite(ts) && Date.now() - ts < cacheTtlMs;
};

const parseUrlInfo = (url: string) => {
  const match = url.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    kind: match[4] === "pull" ? "pr" : "issue",
    number: match[5],
  };
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
        map.set(path, url);
      }
    } catch {
      continue;
    }
  }
  return map;
};

const fetchTitle = (url: string, cache: CacheFile): string | null => {
  if (noTitle) {
    return null;
  }
  const cached = cache[url];
  if (cached && isCacheFresh(cached)) {
    return cached.title;
  }
  const info = parseUrlInfo(url);
  if (!info) {
    return null;
  }
  const env = { ...process.env, GH_HOST: info.host };
  const args = info.kind === "issue"
    ? ["issue", "view", url, "--json", "title"]
    : ["pr", "view", url, "--json", "title"];
  try {
    const raw = run("gh", args, { env });
    const parsed = JSON.parse(raw) as { title?: string };
    if (!parsed.title) {
      return null;
    }
    cache[url] = { title: parsed.title, ts: new Date().toISOString() };
    return parsed.title;
  } catch {
    return null;
  }
};

const gatherEntries = () => {
  const entries: Entry[] = [];
  const worktreeUrlMap = loadWorktreeUrlMap();

  const gwqDirs = readLines(runOptional("fd", ["-d", "4", "--min-depth", "4", "-t", "d", ".", join(homedir(), "gwq")]))
    .map((path) => path.trim());
  for (const path of gwqDirs) {
    if (!path) {
      continue;
    }
    entries.push({ path, kind: "worktree", url: worktreeUrlMap.get(path) ?? null });
  }

  if (includeGhq) {
    const ghqDirs = readLines(runOptional("fd", ["-d", "3", "--min-depth", "3", "-t", "d", ".", join(homedir(), "ghq")]))
      .map((path) => path.trim());
    for (const path of ghqDirs) {
      if (!path) {
        continue;
      }
      entries.push({ path, kind: "repo" });
    }
  }

  return entries;
};

const formatEntry = (entry: Entry, sessionNames: Set<string>, cache: CacheFile) => {
  const sessionName = pathToSessionName(entry.path);
  const existing = sessionNames.has(sessionName);
  const prefix = existing ? "\u001b[32m*\u001b[0m " : "  ";
  const tag = entry.kind === "worktree" ? "[wt]" : "[repo]";
  let label = `${prefix}${tag} ${entry.path}`;
  if (entry.kind === "worktree" && entry.url) {
    const info = parseUrlInfo(entry.url);
    const title = fetchTitle(entry.url, cache);
    if (info?.number && title) {
      label += `  #${info.number} ${title}`;
    }
  }
  return `${label}${delimiter}${entry.path}`;
};

const pickEntry = (entries: Entry[]) => {
  const sessionNames = new Set(readLines(runOptional("tmux", ["list-sessions", "-F", "#{session_name}"])));
  const cache = loadCache();
  const lines = entries.map((entry) => formatEntry(entry, sessionNames, cache));
  if (lines.length === 0) {
    return null;
  }
  const selected = runOptional("fzf", ["--ansi", "--delimiter", delimiter, "--with-nth", "1"], lines.join("\n"));
  saveCache(cache);
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
