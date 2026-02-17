#!/usr/bin/env node

/**
 * journal-write - Writes work session achievement summary to journal
 *
 * Fetches today's ActivityWatch events, builds an achievement summary with
 * hourly commit breakdown and per-worktree stats, and appends to journal.
 *
 * Usage:
 *   npx tsx scripts/wo/bin/journal-write.ts [--date YYYY-MM-DD] [--dry-run]
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
  getTodayTimeRange,
  isServerAvailable,
} from "../lib/sessions/activitywatch";
import {
  buildJournalEntry,
  formatJournalEntry,
} from "../lib/sessions/journal";

const DEFAULT_JOURNAL_PATH = "/home/nixos/ghq/gitlab.com/michalmatoga/journal";

type Options = {
  date: Date;
  journalPath: string;
  dryRun: boolean;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  let date = new Date();
  let dryRun = false;
  const journalPath = process.env.WO_JOURNAL_PATH ?? DEFAULT_JOURNAL_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) {
      date = new Date(args[i + 1]);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { date, journalPath, dryRun };
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
    const marker = `## Work Session - ${dateStr}`;
    return content.includes(marker);
  } catch {
    return false;
  }
};

const run = async (options: Options): Promise<void> => {
  const dateStr = options.date.toISOString().split("T")[0];
  console.log(`journal-write: Generating summary for ${dateStr}`);

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
  const entry = buildJournalEntry(events, options.date);
  const formatted = formatJournalEntry(entry);

  if (options.dryRun) {
    console.log("\n--- DRY RUN OUTPUT ---\n");
    console.log(formatted);
    console.log("\n--- END DRY RUN ---\n");
    return;
  }

  // Write to journal
  const journalFile = getJournalFilePath(options.journalPath, options.date);

  // Check if entry already exists
  if (await journalEntryExists(journalFile, options.date)) {
    console.log(`Journal entry already exists in ${journalFile}`);
    console.log("\n--- SUMMARY ---\n");
    console.log(formatted);
    return;
  }

  // Ensure directory exists
  await mkdir(dirname(journalFile), { recursive: true });

  // Append to journal file
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
