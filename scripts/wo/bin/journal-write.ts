#!/usr/bin/env node

/**
 * journal-write - Writes work session achievement summary to journal
 *
 * Fetches today's ActivityWatch events, builds an achievement summary with
 * hourly commit breakdown and per-worktree stats, and appends to journal.
 *
 * Usage:
 *   npx tsx scripts/wo/bin/journal-write.ts [--date YYYY-MM-DD] [--dry-run] [--lss-shutdown-context <path>]
 *
 * Environment:
 *   WO_JOURNAL_PATH - Path to journal directory
 *     (default: /home/nixos/ghq/gitlab.com/michalmatoga/journal)
 */

import { hostname } from "node:os";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  getEvents,
  isServerAvailable,
} from "../lib/sessions/activitywatch";
import {
  buildJournalEntry,
  formatJournalEntry,
  type LssShutdownContext,
} from "../lib/sessions/journal";
import { loadJournalEnv } from "../lib/journal/env";

const DEFAULT_JOURNAL_PATH = "/home/nixos/ghq/gitlab.com/michalmatoga/journal";

type Options = {
  date: Date;
  journalPath: string;
  dryRun: boolean;
  lssShutdownContextPath: string | null;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  let date = new Date();
  let dryRun = false;
  let lssShutdownContextPath: string | null = null;
  const journalPath = process.env.WO_JOURNAL_PATH ?? DEFAULT_JOURNAL_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) {
      date = new Date(args[i + 1]);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--lss-shutdown-context" && args[i + 1]) {
      lssShutdownContextPath = args[i + 1];
      i++;
    }
  }

  return { date, journalPath, dryRun, lssShutdownContextPath };
};

const loadLssShutdownContext = async (contextPath: string | null): Promise<LssShutdownContext | null> => {
  if (!contextPath) {
    return null;
  }

  try {
    const raw = await readFile(contextPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LssShutdownContext>;
    return {
      committed: Boolean(parsed.committed),
      commitHash: typeof parsed.commitHash === "string" && parsed.commitHash.length > 0
        ? parsed.commitHash
        : null,
      changedFiles: Array.isArray(parsed.changedFiles)
        ? parsed.changedFiles.filter((entry): entry is string => typeof entry === "string")
        : [],
      diff: typeof parsed.diff === "string" ? parsed.diff : "",
    };
  } catch (error) {
    console.warn(
      `journal-write: Failed to load LSS shutdown context from ${contextPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
};

const getBucketId = (): string => {
  const host = hostname();
  return `aw-watcher-tmux_${host}`;
};

const getTimeRangeForDate = (date: Date): { start: string; end: string } => {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return {
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
  };
};

const getJournalFilePath = (journalPath: string, date: Date): string => {
  const dateStr = date.toISOString().split("T")[0];
  return join(journalPath, `${dateStr}.md`);
};

const journalEntryExists = async (filePath: string, date: Date): Promise<boolean> => {
  try {
    const content = await readFile(filePath, "utf8");
    const dateStr = date.toISOString().split("T")[0];
    return content.includes(`## Work Session - ${dateStr}`) || content.includes(`# ${dateStr}`);
  } catch {
    return false;
  }
};

const run = async (options: Options): Promise<void> => {
  const envSource = await loadJournalEnv();
  if (envSource === "dotfiles-local") {
    console.log("journal-write: Loaded .env.local as fallback from dotfiles root");
  } else if (envSource === "cwd-local") {
    console.log("journal-write: Loaded .env.local as fallback from current directory");
  }

  const dateStr = options.date.toISOString().split("T")[0];
  const lssShutdownContext = await loadLssShutdownContext(options.lssShutdownContextPath);
  const boardId = process.env.TRELLO_BOARD_ID_WO;
  const hasTrelloContext = Boolean(
    boardId && process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN,
  );
  console.log(`journal-write: Generating summary for ${dateStr}`);
  if (!hasTrelloContext) {
    console.log("journal-write: Trello board context unavailable; falling back to Unmapped grouping");
  }

  // Check AW server
  if (!(await isServerAvailable())) {
    console.error("ActivityWatch server not available");
    process.exit(1);
  }

  // Fetch events
  const bucketId = getBucketId();
  const { start, end } = getTimeRangeForDate(options.date);

  console.log(`Fetching events from bucket: ${bucketId}`);
  const events = await getEvents(bucketId, { start, end });

  if (events.length === 0) {
    console.log("No events found for this date");
    return;
  }

  console.log(`Found ${events.length} events`);

  // Build journal entry
  const entry = await buildJournalEntry(events, options.date, {
    boardId: hasTrelloContext ? boardId : undefined,
    lssShutdownContext,
  });
  const formatted = await formatJournalEntry(entry);

  if (options.dryRun) {
    console.log("\n--- DRY RUN OUTPUT ---\n");
    console.log(formatted);
    console.log("\n--- END DRY RUN ---\n");
    return;
  }

  // Write to journal
  const journalFile = getJournalFilePath(options.journalPath, options.date);

  // Ensure directory exists
  await mkdir(dirname(journalFile), { recursive: true });

  // Append to journal file
  if (await journalEntryExists(journalFile, options.date)) {
    console.log(`Journal entry already exists in ${journalFile}; appending another entry.`);
  }
  const separator = "\n---\n\n";
  await appendFile(journalFile, separator + formatted + "\n");

  console.log(`Journal entry written to: ${journalFile}`);
  console.log("\n--- SUMMARY ---\n");
  console.log(formatted);
};

(async function main() {
  const options = parseArgs();

  try {
    await run(options);
  } catch (error) {
    console.error(
      "Failed to write journal:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
})();
