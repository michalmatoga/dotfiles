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

type NarrativeBlock = {
  start: Date;
  end: Date;
  buckets: HourlyBucket[];
  commits: CommitInfo[];
  worktrees: Set<string>;
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

const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

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

const uniqueCommitSubjects = (commits: CommitInfo[]): string[] => {
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const commit of commits) {
    const subject = commit.message.trim();
    if (!subject || seen.has(subject)) {
      continue;
    }
    seen.add(subject);
    subjects.push(subject);
  }
  return subjects;
};

const buildNarrativeBlocks = (hourlyBuckets: HourlyBucket[]): NarrativeBlock[] => {
  const sorted = [...hourlyBuckets].sort((a, b) => a.hour - b.hour);
  const blocks: NarrativeBlock[] = [];
  let current: NarrativeBlock | null = null;

  for (const bucket of sorted) {
    if (!current) {
      current = {
        start: new Date(bucket.startTime),
        end: new Date(bucket.endTime),
        buckets: [bucket],
        commits: [...bucket.commits],
        worktrees: new Set(bucket.worktrees),
      };
      continue;
    }

    const lastBucket = current.buckets[current.buckets.length - 1];
    const isContiguous = bucket.hour === lastBucket.hour + 1;
    const withinTwoHours = current.buckets.length < 2;

    if (isContiguous && withinTwoHours) {
      current.buckets.push(bucket);
      current.end = new Date(bucket.endTime);
      current.commits.push(...bucket.commits);
      for (const path of bucket.worktrees) {
        current.worktrees.add(path);
      }
      continue;
    }

    blocks.push(current);
    current = {
      start: new Date(bucket.startTime),
      end: new Date(bucket.endTime),
      buckets: [bucket],
      commits: [...bucket.commits],
      worktrees: new Set(bucket.worktrees),
    };
  }

  if (current) {
    blocks.push(current);
  }

  for (const block of blocks) {
    const byHash = new Map<string, CommitInfo>();
    for (const commit of block.commits) {
      if (!byHash.has(commit.hash)) {
        byHash.set(commit.hash, commit);
      }
    }
    block.commits = Array.from(byHash.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  return blocks;
};

const pickDominantWorktree = (commits: CommitInfo[], worktrees: Set<string>): string | null => {
  if (commits.length > 0) {
    const counts = new Map<string, number>();
    for (const commit of commits) {
      counts.set(commit.worktree, (counts.get(commit.worktree) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [path, count] of counts.entries()) {
      if (count > bestCount) {
        best = path;
        bestCount = count;
      }
    }
    return best;
  }

  for (const path of worktrees) {
    return path;
  }
  return null;
};

const fallbackNarrativeParagraph = (blocks: NarrativeBlock[]): string => {
  const sentences: string[] = [];

  for (const block of blocks) {
    if (block.commits.length > 0) {
      const commitCount = block.commits.length;
      const dominantPath = pickDominantWorktree(block.commits, block.worktrees);
      const dominantLabel = dominantPath ? pathToLabel(dominantPath) : null;
      const labelText = dominantLabel ? ` in ${dominantLabel}` : "";
      sentences.push(`Focused${labelText} and shipped ${commitCount} update${commitCount === 1 ? "" : "s"}.`);
    } else {
      const labels = Array.from(block.worktrees).map(pathToLabel).slice(0, 2);
      const focus = labels.length > 0 ? ` on ${labels.join(" and ")}` : "";
      sentences.push(`Exploration block${focus} with no shipped updates yet.`);
    }
  }

  return sentences.join(" ");
};

const buildOpencodePrompt = (entry: JournalEntry, blocks: NarrativeBlock[]): string => {
  const blockLines = blocks.map((block) => {
    const timeRange = `${formatTime(block.start)}-${formatTime(block.end)}`;
    const dominantPath = pickDominantWorktree(block.commits, block.worktrees);
    const dominantLabel = dominantPath ? pathToLabel(dominantPath) : "unknown";
    const subjects = uniqueCommitSubjects(block.commits).slice(0, 12);
    const worktrees = Array.from(block.worktrees).map(pathToLabel);

    return [
      `- ${timeRange}`,
      `  dominant: ${dominantLabel}`,
      `  worktrees: ${worktrees.join(", ") || "none"}`,
      `  commit_subjects: ${subjects.join(" | ") || "none"}`,
      `  commit_count: ${block.commits.length}`,
    ].join("\n");
  });

  return [
    "You are generating a work session journal narrative.",
    "Output Markdown with hour-by-hour narrative blocks.",
    "Each block must be a Markdown sub-header and a single paragraph below it.",
    "Sub-header format: #### HH:MM-HH:MM - <short title>",
    "Do not use bullet points or lists.",
    "Do not include commit hashes. Use commit subjects only as hints.",
    "Keep it human-friendly and accomplishment-focused, 1-3 sentences per block.",
    "Mention primary repositories within each block where relevant.",
    "If a block has no commits, frame it as exploration or investigation.",
    "",
    `Date: ${entry.date}`,
    `Total active time: ${formatDuration(entry.totalSeconds)}`,
    "",
    "Time blocks:",
    ...blockLines,
  ].join("\n");
};

const generateNarrativeWithOpencode = (entry: JournalEntry, blocks: NarrativeBlock[]): string | null => {
  const prompt = buildOpencodePrompt(entry, blocks);

  const result = spawnSync(
    "opencode",
    ["run", "--model", "openai/gpt-5.2-chat-latest", prompt],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  if (result.error) {
    console.warn(`opencode failed: ${stripAnsi(result.error.message)}`);
    return null;
  }

  if (result.status !== 0 || !result.stdout) {
    const errorText = result.stderr?.trim();
    if (errorText) {
      console.warn(`opencode failed: ${stripAnsi(errorText)}`);
    }
    return null;
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    console.warn("opencode returned empty output");
    return null;
  }

  return output;
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

export const formatJournalEntry = async (entry: JournalEntry): Promise<string> => {
  const lines: string[] = [];

  lines.push(`## Work Session - ${entry.date}`);
  lines.push("");
  lines.push(`**Total active time:** ${formatDuration(entry.totalSeconds)}`);
  lines.push("");

  // Narrative breakdown (grouped)
  if (entry.hourlyBreakdown.length > 0) {
    lines.push("### Session Narrative");
    lines.push("");

    const blocks = buildNarrativeBlocks(entry.hourlyBreakdown);
    const narrative = generateNarrativeWithOpencode(entry, blocks)
      ?? fallbackNarrativeParagraph(blocks);
    lines.push(narrative);
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
