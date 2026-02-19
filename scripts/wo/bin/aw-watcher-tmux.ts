#!/usr/bin/env node

/**
 * aw-watcher-tmux - ActivityWatch watcher for tmux sessions
 *
 * Tracks active time in tmux sessions by sending heartbeats to ActivityWatch.
 * Uses tmux hooks for pane focus changes with periodic polling as fallback.
 * Includes idle detection to prevent over-reporting when terminal loses focus.
 *
 * Usage:
 *   npx tsx scripts/wo/bin/aw-watcher-tmux.ts [--poll-interval <ms>] [--pulsetime <s>] [--verbose]
 *
 * Environment:
 *   AW_HOST - ActivityWatch server host (default: localhost)
 *   AW_PORT - ActivityWatch server port (default: 5601)
 *   AW_IDLE_THRESHOLD_MS - Milliseconds of inactivity before skipping heartbeats (default: 60000)
 */

import { hostname } from "node:os";
import { spawnSync } from "node:child_process";

import { ensureBucket, heartbeat, isServerAvailable } from "../lib/sessions/activitywatch";

const BUCKET_TYPE = "tmux.pane.activity";
const CLIENT_NAME = "aw-watcher-tmux";
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_PULSETIME_S = 60;
const DEFAULT_IDLE_THRESHOLD_MS = 60_000; // 1 minute default idle threshold

type TmuxPaneInfo = {
  sessionName: string;
  panePath: string;
  paneCmd: string;
  paneId: string;
  windowName: string;
};

type ParsedArgs = {
  pollInterval: number;
  pulsetime: number;
  verbose: boolean;
  idleThresholdMs: number;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let pollInterval = DEFAULT_POLL_INTERVAL_MS;
  let pulsetime = DEFAULT_PULSETIME_S;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--poll-interval" && args[i + 1]) {
      pollInterval = Number(args[i + 1]);
      i++;
    } else if (args[i] === "--pulsetime" && args[i + 1]) {
      pulsetime = Number(args[i + 1]);
      i++;
    } else if (args[i] === "--verbose") {
      verbose = true;
    }
  }

  // Parse idle threshold from environment variable (allows user customization)
  const idleThresholdMs = Number(process.env.AW_IDLE_THRESHOLD_MS) || DEFAULT_IDLE_THRESHOLD_MS;

  return { pollInterval, pulsetime, verbose, idleThresholdMs };
};

const runTmux = (args: string[]): string | null => {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout?.trim() ?? null;
};

const isTmuxRunning = (): boolean => {
  return runTmux(["list-sessions", "-F", "#{session_name}"]) !== null;
};

const getActivePaneInfo = (): TmuxPaneInfo | null => {
  // First try to get the most recently active client's session
  const clientOutput = runTmux([
    "list-clients",
    "-F",
    "#{client_activity}|#{session_name}",
  ]);

  let targetSession: string | null = null;

  if (clientOutput) {
    // Find the most recently active client
    const clients = clientOutput
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [activity, session] = line.split("|");
        return { activity: Number(activity), session };
      })
      .sort((a, b) => b.activity - a.activity);

    if (clients.length > 0 && clients[0].session) {
      targetSession = clients[0].session;
    }
  }

  // Fallback: use the first session if no clients attached
  if (!targetSession) {
    const sessionsOutput = runTmux(["list-sessions", "-F", "#{session_name}"]);
    if (sessionsOutput) {
      const sessions = sessionsOutput.split("\n").filter((s) => s.trim().length > 0);
      if (sessions.length > 0) {
        targetSession = sessions[0];
      }
    }
  }

  if (!targetSession) {
    return null;
  }

  // Get info about the active pane in the target session
  const format = "#{session_name}|#{pane_current_path}|#{pane_current_command}|#{pane_id}|#{window_name}";
  const output = runTmux(["display-message", "-t", targetSession, "-p", format]);

  if (!output) {
    return null;
  }

  const parts = output.split("|");
  if (parts.length < 5) {
    return null;
  }

  return {
    sessionName: parts[0],
    panePath: parts[1],
    paneCmd: parts[2],
    paneId: parts[3],
    windowName: parts[4],
  };
};

const getBucketId = (): string => {
  const host = hostname();
  return `aw-watcher-tmux_${host}`;
};

const sendHeartbeat = async (
  bucketId: string,
  pane: TmuxPaneInfo,
  pulsetime: number,
): Promise<void> => {
  await heartbeat({
    bucketId,
    pulsetime,
    event: {
      timestamp: new Date().toISOString(),
      duration: 0,
      data: {
        app: `tmux:${pane.sessionName}`,
        session: pane.sessionName,
        pane_path: pane.panePath,
        pane_cmd: pane.paneCmd,
        pane_id: pane.paneId,
        window_name: pane.windowName,
      },
    },
  });
};

const setupTmuxHooks = (scriptPath: string): void => {
  // Set up tmux hooks to trigger heartbeats on pane focus changes
  // These call this script with --hook flag to send a single heartbeat
  const hookCmd = `run-shell "npx --yes tsx ${scriptPath} --hook &"`;

  // Hook into pane focus events
  runTmux(["set-hook", "-g", "pane-focus-in", hookCmd]);
  runTmux(["set-hook", "-g", "client-session-changed", hookCmd]);
  runTmux(["set-hook", "-g", "window-pane-changed", hookCmd]);
};

const removeTmuxHooks = (): void => {
  runTmux(["set-hook", "-gu", "pane-focus-in"]);
  runTmux(["set-hook", "-gu", "client-session-changed"]);
  runTmux(["set-hook", "-gu", "window-pane-changed"]);
};

const runSingleHeartbeat = async (pulsetime: number): Promise<void> => {
  if (!(await isServerAvailable())) {
    return;
  }

  const pane = getActivePaneInfo();
  if (!pane) {
    return;
  }

  const bucketId = getBucketId();
  await sendHeartbeat(bucketId, pane, pulsetime);
};

// Generate a unique key for pane state comparison
const getPaneStateKey = (pane: TmuxPaneInfo): string => {
  return `${pane.paneId}:${pane.panePath}:${pane.paneCmd}`;
};

const runDaemon = async (args: ParsedArgs): Promise<void> => {
  const { pollInterval, pulsetime, verbose, idleThresholdMs } = args;

  console.log(`aw-watcher-tmux starting (poll: ${pollInterval}ms, pulsetime: ${pulsetime}s, idle-threshold: ${idleThresholdMs}ms)`);

  // Wait for AW server to be available
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

  const bucketId = getBucketId();
  console.log(`Using bucket: ${bucketId}`);

  // Ensure bucket exists
  await ensureBucket({
    bucketId,
    type: BUCKET_TYPE,
    client: CLIENT_NAME,
  });

  // Set up tmux hooks for real-time tracking
  const scriptPath = process.argv[1];
  setupTmuxHooks(scriptPath);
  console.log("Tmux hooks installed");

  // Handle shutdown gracefully
  const cleanup = () => {
    console.log("\nCleaning up tmux hooks...");
    removeTmuxHooks();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Polling loop as fallback and for initial state
  // Track pane state for idle detection
  let lastPaneStateKey = "";
  let lastStateChangeTime = Date.now();

  const poll = async () => {
    if (!isTmuxRunning()) {
      return;
    }

    const pane = getActivePaneInfo();
    if (!pane) {
      return;
    }

    const currentPaneKey = getPaneStateKey(pane);
    const now = Date.now();

    // Check if pane state changed
    if (currentPaneKey !== lastPaneStateKey) {
      // Pane changed - update tracking and send heartbeat
      if (verbose && lastPaneStateKey) {
        console.log(`[${new Date().toLocaleTimeString()}] Pane changed: ${pane.sessionName} @ ${pane.panePath} (${pane.paneCmd})`);
      }
      lastPaneStateKey = currentPaneKey;
      lastStateChangeTime = now;
    } else {
      // Pane unchanged - check idle threshold
      const idleDuration = now - lastStateChangeTime;
      if (idleDuration > idleThresholdMs) {
        // Pane has been idle for too long - skip heartbeat
        if (verbose) {
          console.log(`[${new Date().toLocaleTimeString()}] Skipping heartbeat - pane idle for ${Math.round(idleDuration / 1000)}s`);
        }
        return;
      }
    }

    try {
      await sendHeartbeat(bucketId, pane, pulsetime);
      if (verbose) {
        console.log(`[${new Date().toLocaleTimeString()}] Heartbeat sent: ${pane.sessionName} @ ${pane.panePath}`);
      }
    } catch (error) {
      console.error("Heartbeat failed:", error instanceof Error ? error.message : String(error));
    }
  };

  // Initial poll
  await poll();

  // Set up polling interval
  setInterval(poll, pollInterval);
};

(async function main() {
  const args = parseArgs();
  const isHook = process.argv.includes("--hook");

  if (isHook) {
    // Called from tmux hook - send single heartbeat and exit
    // Hooks always send heartbeats (they indicate user activity)
    await runSingleHeartbeat(args.pulsetime);
  } else {
    // Run as daemon
    await runDaemon(args);
  }
})();
