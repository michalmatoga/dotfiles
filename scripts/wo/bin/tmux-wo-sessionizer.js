#!/usr/bin/env node
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
const delimiter = "";
const cacheTtlMs = 24 * 60 * 60 * 1e3;
const scriptDir = __dirname;
const repoRoot = (0, import_node_path.join)(scriptDir, "../../..");
const stateDir = (0, import_node_path.join)(repoRoot, "scripts/wo/state");
const cachePath = (0, import_node_path.join)(stateDir, "wo-sessionizer-cache.json");
const eventsPath = (0, import_node_path.join)(stateDir, "wf-events.jsonl");
const args = process.argv.slice(2);
const argPath = args.find((arg) => !arg.startsWith("--")) ?? null;
const includeGhq = !args.includes("--gwq-only");
const noTitle = args.includes("--no-title");
const dryRun = args.includes("--dry-run");
const run = (command, commandArgs, options = {}) => {
  const result = (0, import_node_child_process.spawnSync)(command, commandArgs, {
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env
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
const runOptional = (command, commandArgs) => {
  try {
    return run(command, commandArgs);
  } catch {
    return "";
  }
};
const readLines = (value) => value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
const pathToSessionName = (path) => {
  const home = (0, import_node_os.homedir)();
  const rel = path.startsWith(home) ? (0, import_node_path.relative)(home, path) : path;
  return rel.replace(/[/.]/g, "_");
};
const loadCache = () => {
  if (!(0, import_node_fs.existsSync)(cachePath)) {
    return {};
  }
  try {
    const content = (0, import_node_fs.readFileSync)(cachePath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
};
const saveCache = (cache) => {
  (0, import_node_fs.mkdirSync)(stateDir, { recursive: true });
  (0, import_node_fs.writeFileSync)(cachePath, JSON.stringify(cache, null, 2));
};
const isCacheFresh = (entry) => {
  const ts = new Date(entry.ts).getTime();
  return Number.isFinite(ts) && Date.now() - ts < cacheTtlMs;
};
const parseUrlInfo = (url) => {
  const match = url.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    kind: match[4] === "pull" ? "pr" : "issue",
    number: match[5]
  };
};
const loadWorktreeUrlMap = () => {
  if (!(0, import_node_fs.existsSync)(eventsPath)) {
    return /* @__PURE__ */ new Map();
  }
  const map = /* @__PURE__ */ new Map();
  const content = (0, import_node_fs.readFileSync)(eventsPath, "utf8");
  for (const line of readLines(content)) {
    try {
      const event = JSON.parse(line);
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
const fetchTitle = (url, cache) => {
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
  const args2 = info.kind === "issue" ? ["issue", "view", url, "--json", "title"] : ["pr", "view", url, "--json", "title"];
  try {
    const raw = run("gh", args2, { env });
    const parsed = JSON.parse(raw);
    if (!parsed.title) {
      return null;
    }
    cache[url] = { title: parsed.title, ts: (/* @__PURE__ */ new Date()).toISOString() };
    return parsed.title;
  } catch {
    return null;
  }
};
const gatherEntries = () => {
  const entries = [];
  const worktreeUrlMap = loadWorktreeUrlMap();
  const gwqDirs = readLines(runOptional("fd", ["-d", "4", "--min-depth", "4", "-t", "d", ".", (0, import_node_path.join)((0, import_node_os.homedir)(), "gwq")])).map((path) => path.trim());
  for (const path of gwqDirs) {
    if (!path) {
      continue;
    }
    entries.push({ path, kind: "worktree", url: worktreeUrlMap.get(path) ?? null });
  }
  if (includeGhq) {
    const ghqDirs = readLines(runOptional("fd", ["-d", "3", "--min-depth", "3", "-t", "d", ".", (0, import_node_path.join)((0, import_node_os.homedir)(), "ghq")])).map((path) => path.trim());
    for (const path of ghqDirs) {
      if (!path) {
        continue;
      }
      entries.push({ path, kind: "repo" });
    }
  }
  return entries;
};
const formatEntry = (entry, sessionNames, cache) => {
  const sessionName2 = pathToSessionName(entry.path);
  const existing = sessionNames.has(sessionName2);
  const prefix = existing ? "\x1B[32m*\x1B[0m " : "  ";
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
const pickEntry = (entries) => {
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
