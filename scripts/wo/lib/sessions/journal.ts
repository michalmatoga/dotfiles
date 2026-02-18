import { spawnSync } from "node:child_process";
import {
  aggregateUniqueDuration,
  aggregateUniqueDurationByDataKey,
  aggregateUniqueDurationByHour,
  collectDataKeyByHour,
  type AWEvent,
} from "./activitywatch";

export type HourlyBucket = {
  hour: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  commits: CommitInfo[];
  worktrees: Set<string>;
};

export type CommitInfo = {
  hash: string;
  message: string;
  timestamp: Date;
  worktree: string;
};

export type WorktreeSummary = {
  path: string;
  label: string;
  durationSeconds: number;
  commitCount: number;
};

export type JournalEntry = {
  date: string;
  totalSeconds: number;
  hourlyBreakdown: HourlyBucket[];
  worktreeSummaries: WorktreeSummary[];
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatHour = (hour: number): string => {
  return `${hour.toString().padStart(2, "0")}:00`;
};

const pathToLabel = (path: string): string => {
  // Convert /home/nixos/gwq/github.com/org/repo/branch to org/repo
  // or /home/nixos/ghq/github.com/org/repo to org/repo
  const match = path.match(/\/(ghq|gwq)\/[^/]+\/([^/]+\/[^/]+)/);
  if (match) {
    return match[2];
  }
  // Fallback: last two path components
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return path;
};

export const getCommitsForWorktree = (
  worktreePath: string,
  startTime: Date,
  endTime: Date,
): CommitInfo[] => {
  const since = startTime.toISOString();
  const until = endTime.toISOString();

  try {
    const result = spawnSync(
      "git",
      [
        "log",
        `--since=${since}`,
        `--until=${until}`,
        "--pretty=format:%H|%s|%aI",
        "--no-merges",
      ],
      {
        cwd: worktreePath,
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    if (result.status !== 0 || !result.stdout) {
      return [];
    }

    return result.stdout
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [hash, message, timestamp] = line.split("|");
        return {
          hash: hash ?? "",
          message: message ?? "",
          timestamp: new Date(timestamp ?? ""),
          worktree: worktreePath,
        };
      });
  } catch {
    return [];
  }
};

export const buildHourlyBreakdown = (
  events: AWEvent[],
  date: Date,
): HourlyBucket[] => {
  const hourDurations = aggregateUniqueDurationByHour(events);
  const worktreesByHour = collectDataKeyByHour(events, "pane_path");

  const hourlyBuckets: HourlyBucket[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const durationSeconds = hourDurations.get(hour) ?? 0;
    if (durationSeconds === 0) {
      continue;
    }

    const worktrees = worktreesByHour.get(hour) ?? new Set<string>();

    // Get commits for this hour from all touched worktrees
    const startTime = new Date(date);
    startTime.setHours(hour, 0, 0, 0);
    const endTime = new Date(date);
    endTime.setHours(hour + 1, 0, 0, 0);

    const commits: CommitInfo[] = [];
    for (const path of Array.from(worktrees)) {
      commits.push(...getCommitsForWorktree(path, startTime, endTime));
    }

    hourlyBuckets.push({
      hour,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds,
      commits,
      worktrees,
    });
  }

  return hourlyBuckets;
};

export const buildWorktreeSummaries = (
  events: AWEvent[],
  hourlyBuckets: HourlyBucket[],
): WorktreeSummary[] => {
  const summaryMap = new Map<string, { duration: number; commits: number }>();
  const durationByPath = aggregateUniqueDurationByDataKey(events, "pane_path");

  for (const [path, duration] of durationByPath.entries()) {
    summaryMap.set(path, { duration, commits: 0 });
  }

  // Count commits per worktree
  for (const bucket of hourlyBuckets) {
    for (const commit of bucket.commits) {
      const existing = summaryMap.get(commit.worktree);
      if (existing) {
        existing.commits++;
      }
    }
  }

  return Array.from(summaryMap.entries())
    .map(([path, data]) => ({
      path,
      label: pathToLabel(path),
      durationSeconds: data.duration,
      commitCount: data.commits,
    }))
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
};

export const formatJournalEntry = (entry: JournalEntry): string => {
  const lines: string[] = [];

  lines.push(`## Work Session - ${entry.date}`);
  lines.push("");
  lines.push(`**Total active time:** ${formatDuration(entry.totalSeconds)}`);
  lines.push("");

  // Hourly breakdown
  if (entry.hourlyBreakdown.length > 0) {
    lines.push("### Hourly Breakdown");
    lines.push("");

    for (const bucket of entry.hourlyBreakdown) {
      const timeRange = `${formatHour(bucket.hour)}-${formatHour(bucket.hour + 1)}`;
      const commitSummary =
        bucket.commits.length > 0
          ? ` - ${bucket.commits.length} commit${bucket.commits.length > 1 ? "s" : ""}`
          : "";
      const worktreeLabels = Array.from(bucket.worktrees).map(pathToLabel);
      const worktreeSummary =
        worktreeLabels.length > 0 ? ` in ${worktreeLabels.join(", ")}` : "";

      lines.push(`- ${timeRange}: ${formatDuration(bucket.durationSeconds)}${commitSummary}${worktreeSummary}`);

      // List commit messages
      for (const commit of bucket.commits) {
        const shortHash = commit.hash.slice(0, 7);
        lines.push(`  - \`${shortHash}\` ${commit.message}`);
      }
    }
    lines.push("");
  }

  // Per-worktree summary table
  if (entry.worktreeSummaries.length > 0) {
    lines.push("### Per-Worktree Summary");
    lines.push("");
    lines.push("| Worktree | Time | Commits |");
    lines.push("|----------|------|---------|");

    for (const summary of entry.worktreeSummaries) {
      lines.push(
        `| ${summary.label} | ${formatDuration(summary.durationSeconds)} | ${summary.commitCount} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
};

export const buildJournalEntry = (
  events: AWEvent[],
  date: Date,
): JournalEntry => {
  const totalSeconds = aggregateUniqueDuration(events);
  const hourlyBreakdown = buildHourlyBreakdown(events, date);
  const worktreeSummaries = buildWorktreeSummaries(events, hourlyBreakdown);

  return {
    date: date.toISOString().split("T")[0],
    totalSeconds,
    hourlyBreakdown,
    worktreeSummaries,
  };
};
