#!/usr/bin/env node

/**
 * session-monitor - Monitors work session time and triggers shutdown ritual
 *
 * Polls ActivityWatch for tmux session time, updates status bar, and triggers
 * forced shutdown when daily limit is reached.
 *
 * Usage:
 *   npx tsx scripts/wo/bin/session-monitor.ts [--limit <minutes>] [--grace <minutes>]
 *
 * Environment:
 *   WO_SESSION_LIMIT_MINUTES - Daily limit in minutes (default: 240 = 4h)
 *   WO_SESSION_GRACE_MINUTES - Grace period before forced shutdown (default: 5)
 *   WO_SESSION_PROTECTED - Comma-separated list of protected session names
 */

import { homedir, hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  getEvents,
  getTodayTimeRange,
  aggregateUniqueDuration,
  aggregateUniqueDurationByDataKey,
  isServerAvailable,
} from "../lib/sessions/activitywatch";

const STATUS_FILE = join(homedir(), ".wo", "session-status");
const ALERT_FILE = join(homedir(), ".wo", "session-alert");
const DEFAULT_LIMIT_MINUTES = 240;
const DEFAULT_GRACE_MINUTES = 5;
const DEFAULT_PROTECTED_SESSIONS = ["journal", "dotfiles"];
const POLL_INTERVAL_MS = 30_000;

type Config = {
  limitMinutes: number;
  graceMinutes: number;
  protectedSessions: string[];
};

type SessionStats = {
  totalSeconds: number;
  byWorktree: Map<string, number>;
  limitSeconds: number;
  remainingSeconds: number;
  isOverLimit: boolean;
};

const parseArgs = (): Config => {
  const args = process.argv.slice(2);
  let limitMinutes = Number(process.env.WO_SESSION_LIMIT_MINUTES) || DEFAULT_LIMIT_MINUTES;
  let graceMinutes = Number(process.env.WO_SESSION_GRACE_MINUTES) || DEFAULT_GRACE_MINUTES;
  const protectedEnv = process.env.WO_SESSION_PROTECTED ?? "";
  let protectedSessions = protectedEnv
    ? protectedEnv.split(",").map((s) => s.trim())
    : DEFAULT_PROTECTED_SESSIONS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limitMinutes = Number(args[i + 1]);
      i++;
    } else if (args[i] === "--grace" && args[i + 1]) {
      graceMinutes = Number(args[i + 1]);
      i++;
    } else if (args[i] === "--protected" && args[i + 1]) {
      protectedSessions = args[i + 1].split(",").map((s) => s.trim());
      i++;
    }
  }

  return { limitMinutes, graceMinutes, protectedSessions };
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

const formatDurationFull = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const createFallbackStats = (config: Config): SessionStats => ({
  totalSeconds: 0,
  byWorktree: new Map(),
  limitSeconds: config.limitMinutes * 60,
  remainingSeconds: config.limitMinutes * 60,
  isOverLimit: false,
});

const getBucketId = (): string => {
  const host = hostname();
  return `aw-watcher-tmux_${host}`;
};

const fetchTodayStats = async (config: Config): Promise<SessionStats | null> => {
  const bucketId = getBucketId();
  const { start, end } = getTodayTimeRange();

  try {
    const events = await getEvents(bucketId, { start, end });
    const totalSeconds = aggregateUniqueDuration(events);
    const byWorktree = aggregateUniqueDurationByDataKey(events, "pane_path");

    const limitSeconds = config.limitMinutes * 60;
    const remainingSeconds = Math.max(0, limitSeconds - totalSeconds);
    const isOverLimit = totalSeconds >= limitSeconds;

    return {
      totalSeconds,
      byWorktree,
      limitSeconds,
      remainingSeconds,
      isOverLimit,
    };
  } catch (error) {
    console.error("Failed to fetch events:", error instanceof Error ? error.message : String(error));
    return null;
  }
};

const writeStatusFile = async (stats: SessionStats, config: Config): Promise<void> => {
  const percentage = Math.min(100, Math.round((stats.totalSeconds / stats.limitSeconds) * 100));
  const status = `${formatDuration(stats.totalSeconds)} / ${formatDuration(stats.limitSeconds)} (${percentage}%)`;

  await mkdir(dirname(STATUS_FILE), { recursive: true });
  await writeFile(STATUS_FILE, status);
};

const writeAlertFile = async (message: string): Promise<void> => {
  await mkdir(dirname(ALERT_FILE), { recursive: true });
  await writeFile(ALERT_FILE, message);
};

const clearAlertFile = async (): Promise<void> => {
  try {
    await writeFile(ALERT_FILE, "");
  } catch {
    // Ignore if file doesn't exist
  }
};

const runTmux = (args: string[]): string | null => {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout?.trim() ?? null;
};

const listTmuxSessions = (): string[] => {
  const output = runTmux(["list-sessions", "-F", "#{session_name}"]);
  if (!output) {
    return [];
  }
  return output.split("\n").filter((s) => s.length > 0);
};

const showPopup = async (config: Config, stats: SessionStats): Promise<string | null> => {
  const message = `Time limit reached!\\n\\nTotal: ${formatDurationFull(stats.totalSeconds)}\\nLimit: ${formatDurationFull(stats.limitSeconds)}\\n\\nSelect action:`;

  // Use tmux display-popup with fzf for selection
  const options = ["Extend 30 minutes", "Extend 1 hour", "Start shutdown ritual"];
  const input = options.join("\n");

  const result = spawnSync(
    "tmux",
    [
      "display-popup",
      "-E",
      "-w", "50%",
      "-h", "50%",
      `echo "${message}" && echo "" && echo "${input}" | fzf --header="Work Session Alert"`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  return result.stdout.trim();
};

const playAlertSound = (): void => {
  // Try to play alert sound via Windows (works in WSL)
  spawnSync("powershell.exe", [
    "-Command",
    "[System.Media.SystemSounds]::Exclamation.Play()",
  ], { stdio: "ignore" });
};

const killNonProtectedSessions = (protectedSessions: string[]): void => {
  const sessions = listTmuxSessions();
  const protectedSet = new Set(protectedSessions.map((s) => s.toLowerCase()));

  for (const session of sessions) {
    if (!protectedSet.has(session.toLowerCase())) {
      console.log(`Killing session: ${session}`);
      runTmux(["kill-session", "-t", session]);
    }
  }
};

const ensureJournalSession = (): void => {
  const sessions = listTmuxSessions();
  if (!sessions.includes("journal")) {
    console.log("Creating journal session...");
    const home = homedir();
    runTmux(["new-session", "-d", "-s", "journal", "-c", home]);
  }
};

const startShutdownRitual = async (config: Config, stats: SessionStats): Promise<void> => {
  console.log("\n=== Starting Shutdown Ritual ===\n");

  // Ensure journal session exists
  ensureJournalSession();

  // Switch current client to journal session (if tmux is attached)
  runTmux(["switch-client", "-t", "journal"]);

  // Small delay to let user see what's happening
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Kill all non-protected sessions
  killNonProtectedSessions(config.protectedSessions);

  // Run journal writer
  const scriptDir = dirname(process.argv[1]);
  const journalScript = join(scriptDir, "journal-write.ts");
  console.log("Running journal writer...");
  spawnSync("npx", ["--yes", "tsx", journalScript], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  console.log("\nShutdown ritual complete. Journal session is ready.");
};

let alertShown = false;
let extendedMinutes = 0;
let shutdownInProgress = false;

const runMonitor = async (config: Config): Promise<void> => {
  const effectiveLimitMinutes = config.limitMinutes + extendedMinutes;
  const effectiveConfig = { ...config, limitMinutes: effectiveLimitMinutes };

  console.log(`session-monitor starting (limit: ${effectiveLimitMinutes}m, grace: ${config.graceMinutes}m)`);
  console.log(`Protected sessions: ${config.protectedSessions.join(", ")}`);

  // Wait for AW server
  let retries = 0;
  while (!(await isServerAvailable())) {
    retries++;
    if (retries > 30) {
      console.error("ActivityWatch server not available after 30 retries, exiting");
      process.exit(1);
    }
    console.log(`Waiting for ActivityWatch server (attempt ${retries})...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("Connected to ActivityWatch server");

  const startShutdownNow = async () => {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;
    await clearAlertFile();
    console.log("\n=== On-demand Shutdown Requested ===\n");
    const stats = (await fetchTodayStats(effectiveConfig)) ?? createFallbackStats(effectiveConfig);
    await startShutdownRitual(config, stats);
    process.exit(0);
  };

  const tick = async () => {
    const stats = await fetchTodayStats(effectiveConfig);
    if (!stats) {
      return;
    }

    // Update status file
    await writeStatusFile(stats, effectiveConfig);

    // Log status
    const percentage = Math.round((stats.totalSeconds / stats.limitSeconds) * 100);
    console.log(`[${new Date().toLocaleTimeString()}] ${formatDurationFull(stats.totalSeconds)} / ${formatDuration(stats.limitSeconds)} (${percentage}%)`);

    // Check if over limit
    if (stats.isOverLimit && !alertShown) {
      alertShown = true;
      await writeAlertFile("LIMIT_REACHED");
      playAlertSound();

      console.log("\n*** TIME LIMIT REACHED ***\n");

      // Show popup for user choice
      const choice = await showPopup(effectiveConfig, stats);

      if (choice?.includes("30 minutes")) {
        extendedMinutes += 30;
        alertShown = false;
        await clearAlertFile();
        console.log("Extended by 30 minutes");
      } else if (choice?.includes("1 hour")) {
        extendedMinutes += 60;
        alertShown = false;
        await clearAlertFile();
        console.log("Extended by 1 hour");
      } else {
        // No response or shutdown chosen - start grace period
        console.log(`Starting ${config.graceMinutes} minute grace period...`);
        await writeAlertFile(`GRACE_PERIOD:${config.graceMinutes}`);

        // Wait for grace period
        await new Promise((resolve) =>
          setTimeout(resolve, config.graceMinutes * 60 * 1000)
        );

        // Force shutdown
        await startShutdownRitual(config, stats);
        process.exit(0);
      }
    }
  };

  // Handle signals
  const cleanup = async () => {
    console.log("\nShutting down session monitor...");
    await clearAlertFile();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGUSR1", () => {
    void startShutdownNow();
  });

  // Initial tick
  await tick();

  // Polling loop
  setInterval(tick, POLL_INTERVAL_MS);
};

(async function main() {
  const config = parseArgs();
  await runMonitor(config);
})();
