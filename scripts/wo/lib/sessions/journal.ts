import { spawnSync } from "node:child_process";

import {
  aggregateUniqueDuration,
  aggregateUniqueDurationByDataKey,
  aggregateUniqueDurationByHour,
  collectDataKeyByHour,
  type AWEvent,
} from "./activitywatch";
import {
  buildCardIndex,
  buildPathToUrlMap,
  findUrlForPath,
  normalizePath,
} from "../metrics/aw-time";
import {
  indexLssAreas,
  loadLssAreas,
  resolveLssArea,
  UNMAPPED_LSS_AREA_KEY,
  UNMAPPED_LSS_AREA_TITLE,
  type LssArea,
} from "../trello/lss-areas";

type AreaStatus = "single" | "none" | "multiple";

type PathAreaResolution = {
  areaKey: string;
  areaTitle: string;
  status: AreaStatus;
};

type AreaSummaryGenerator = (summary: AreaSummary) => Promise<string>;

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
  areaKey: string;
  areaTitle: string;
  areaStatus: AreaStatus;
};

export type AreaSummary = {
  key: string;
  title: string;
  durationSeconds: number;
  worktreeSummaries: WorktreeSummary[];
  commitSubjects: string[];
  hasUnlabeledCards: boolean;
  hasAmbiguousCards: boolean;
};

export type JournalEntry = {
  date: string;
  totalSeconds: number;
  hourlyBreakdown: HourlyBucket[];
  worktreeSummaries: WorktreeSummary[];
  areaSummaries: AreaSummary[];
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

export const pathToLabel = (path: string): string => {
  const match = path.match(/\/ghq\/[^/]+\/([^/]+)\/([^/]+)/);
  if (match) {
    const owner = match[1];
    const repoSegment = match[2];
    const repo = repoSegment.split("=")[0] ?? repoSegment;
    if (owner && repo) {
      return `${owner}/${repo}`;
    }
  }
  const parts = path.split("/").filter((part) => part.length > 0);
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

const defaultAreaResolution = (): PathAreaResolution => ({
  areaKey: UNMAPPED_LSS_AREA_KEY,
  areaTitle: UNMAPPED_LSS_AREA_TITLE,
  status: "none",
});

const getPathAreaResolution = (
  path: string,
  resolutions: Map<string, PathAreaResolution>,
): PathAreaResolution => resolutions.get(path) ?? resolutions.get(normalizePath(path)) ?? defaultAreaResolution();

const buildPathAreaResolutions = async (
  paths: string[],
  boardId: string,
  areas: LssArea[],
): Promise<Map<string, PathAreaResolution>> => {
  const [pathToUrl, cardIndex] = await Promise.all([buildPathToUrlMap(), buildCardIndex(boardId)]);
  const entries = Array.from(pathToUrl.entries())
    .map(([path, url]) => ({ path: normalizePath(path), url }))
    .sort((a, b) => b.path.length - a.path.length);
  const areaByLabel = indexLssAreas(areas);
  const resolutions = new Map<string, PathAreaResolution>();

  for (const originalPath of paths) {
    const normalizedPath = normalizePath(originalPath);
    const url = findUrlForPath(normalizedPath, entries);
    const card = url ? cardIndex.get(url) : null;
    const resolution = resolveLssArea({ labelNames: card?.labels ?? [], areaByLabel });

    const mapped = resolution.status === "single"
      ? {
          areaKey: resolution.area.label,
          areaTitle: resolution.area.title,
          status: "single" as const,
        }
      : {
          areaKey: UNMAPPED_LSS_AREA_KEY,
          areaTitle: UNMAPPED_LSS_AREA_TITLE,
          status: resolution.status,
        };

    resolutions.set(originalPath, mapped);
    resolutions.set(normalizedPath, mapped);
  }

  return resolutions;
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
  pathAreaResolutions: Map<string, PathAreaResolution>,
): WorktreeSummary[] => {
  const summaryMap = new Map<string, { duration: number; commits: number }>();
  const durationByPath = aggregateUniqueDurationByDataKey(events, "pane_path");

  for (const [path, duration] of durationByPath.entries()) {
    summaryMap.set(path, { duration, commits: 0 });
  }

  for (const bucket of hourlyBuckets) {
    for (const commit of bucket.commits) {
      const existing = summaryMap.get(commit.worktree);
      if (existing) {
        existing.commits++;
      }
    }
  }

  return Array.from(summaryMap.entries())
    .map(([path, data]) => {
      const area = getPathAreaResolution(path, pathAreaResolutions);
      return {
        path,
        label: pathToLabel(path),
        durationSeconds: data.duration,
        commitCount: data.commits,
        areaKey: area.areaKey,
        areaTitle: area.areaTitle,
        areaStatus: area.status,
      };
    })
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
};

export const buildAreaSummaries = (options: {
  hourlyBuckets: HourlyBucket[];
  worktreeSummaries: WorktreeSummary[];
  orderedAreaKeys?: string[];
}): AreaSummary[] => {
  const accumulators = new Map<string, AreaSummary & { subjectSet: Set<string> }>();
  const summaryByPath = new Map(
    options.worktreeSummaries.map((summary) => [normalizePath(summary.path), summary]),
  );

  const ensureArea = (key: string, title: string) => {
    const existing = accumulators.get(key);
    if (existing) {
      return existing;
    }
    const created: AreaSummary & { subjectSet: Set<string> } = {
      key,
      title,
      durationSeconds: 0,
      worktreeSummaries: [],
      commitSubjects: [],
      hasUnlabeledCards: false,
      hasAmbiguousCards: false,
      subjectSet: new Set<string>(),
    };
    accumulators.set(key, created);
    return created;
  };

  for (const worktree of options.worktreeSummaries) {
    const area = ensureArea(worktree.areaKey, worktree.areaTitle);
    area.durationSeconds += worktree.durationSeconds;
    area.worktreeSummaries.push(worktree);
    if (worktree.areaStatus === "none") {
      area.hasUnlabeledCards = true;
    }
    if (worktree.areaStatus === "multiple") {
      area.hasAmbiguousCards = true;
    }
  }

  for (const bucket of options.hourlyBuckets) {
    for (const commit of bucket.commits) {
      const worktree = summaryByPath.get(normalizePath(commit.worktree));
      if (!worktree) {
        continue;
      }
      const area = ensureArea(worktree.areaKey, worktree.areaTitle);
      const subject = commit.message.trim();
      if (!subject || area.subjectSet.has(subject)) {
        continue;
      }
      area.subjectSet.add(subject);
      area.commitSubjects.push(subject);
    }
  }

  const order = new Map<string, number>();
  for (const [index, key] of (options.orderedAreaKeys ?? []).entries()) {
    order.set(key, index);
  }
  order.set(UNMAPPED_LSS_AREA_KEY, Number.MAX_SAFE_INTEGER);

  return Array.from(accumulators.values())
    .map(({ subjectSet: _subjectSet, ...summary }) => ({
      ...summary,
      worktreeSummaries: [...summary.worktreeSummaries].sort(
        (a, b) => b.durationSeconds - a.durationSeconds,
      ),
    }))
    .filter((summary) => summary.durationSeconds > 0)
    .sort((a, b) => {
      const left = order.get(a.key) ?? Number.MAX_SAFE_INTEGER - 1;
      const right = order.get(b.key) ?? Number.MAX_SAFE_INTEGER - 1;
      if (left !== right) {
        return left - right;
      }
      return b.durationSeconds - a.durationSeconds;
    });
};

export const buildAreaSummaryPrompt = (summary: AreaSummary): string => {
  const repositories = summary.worktreeSummaries
    .slice(0, 5)
    .map((worktree) => `${worktree.label} (${formatDuration(worktree.durationSeconds)})`)
    .join(", ");
  const commits = summary.commitSubjects.slice(0, 8).join(" | ");

  const guidance: string[] = [];
  if (summary.key === UNMAPPED_LSS_AREA_KEY) {
    guidance.push(
      "Explain that the work is kept here because the cards did not map to exactly one LSS area label.",
    );
    if (summary.hasUnlabeledCards) {
      guidance.push("Mention that some cards had no LSS area label.");
    }
    if (summary.hasAmbiguousCards) {
      guidance.push("Mention that some cards had multiple LSS area labels.");
    }
  } else if (summary.commitSubjects.length === 0) {
    guidance.push("Frame the work as investigation, planning, maintenance, or coordination work.");
  }

  return [
    "You are generating a work session journal summary for a single LSS area.",
    "Output a single Markdown paragraph only.",
    "Do not output headings, bullet points, or lists.",
    "Keep it human-friendly and accomplishment-focused in 1-3 sentences.",
    "Mention the primary repositories when relevant.",
    "Do not include commit hashes.",
    `Area: ${summary.title}`,
    `Total active time: ${formatDuration(summary.durationSeconds)}`,
    `Repositories: ${repositories || "none"}`,
    `Commit subjects: ${commits || "none"}`,
    `Guidance: ${guidance.join(" ") || "Summarize the main work and outcomes."}`,
  ].join("\n");
};

const generateAreaSummaryWithOpencode = async (summary: AreaSummary): Promise<string> => {
  const prompt = buildAreaSummaryPrompt(summary);

  const result = spawnSync(
    "opencode",
    ["run", "--model", "openai/gpt-5.2-chat-latest", prompt],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("opencode not found on PATH; ensure it is available for journal-write.");
    }
    throw new Error(`opencode failed: ${stripAnsi(result.error.message)}`);
  }

  if (result.status !== 0 || !result.stdout) {
    const errorText = result.stderr?.trim();
    if (errorText) {
      throw new Error(`opencode failed: ${stripAnsi(errorText)}`);
    }
    throw new Error("opencode failed with no output");
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new Error("opencode returned empty output");
  }

  return output.replace(/^```[a-z]*\n?/i, "").replace(/\n```$/, "").trim();
};

export const formatJournalEntry = async (
  entry: JournalEntry,
  options: { generateAreaSummary?: AreaSummaryGenerator } = {},
): Promise<string> => {
  const generateAreaSummary = options.generateAreaSummary ?? generateAreaSummaryWithOpencode;
  const lines: string[] = [];

  lines.push(`# ${entry.date}`);
  lines.push("");
  lines.push(`**Deep work time:** ${formatDuration(entry.totalSeconds)}`);
  lines.push("");

  const areaSummaries = await Promise.all(
    entry.areaSummaries.map(async (area) => ({
      area,
      summaryText: (await generateAreaSummary(area)).replace(/\s*\n\s*/g, " ").trim(),
    })),
  );

  for (const { area, summaryText } of areaSummaries) {
    lines.push(`## ${area.title}`);
    lines.push(`**Total:** ${formatDuration(area.durationSeconds)}`);
    lines.push(summaryText);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

export const buildJournalEntry = async (
  events: AWEvent[],
  date: Date,
  options: { boardId?: string },
): Promise<JournalEntry> => {
  const totalSeconds = aggregateUniqueDuration(events);
  const hourlyBreakdown = buildHourlyBreakdown(events, date);
  const trackedPaths = Array.from(aggregateUniqueDurationByDataKey(events, "pane_path").keys());
  const areas = await loadLssAreas();
  const pathAreaResolutions = options.boardId
    ? await buildPathAreaResolutions(trackedPaths, options.boardId, areas)
    : new Map<string, PathAreaResolution>();
  const worktreeSummaries = buildWorktreeSummaries(events, hourlyBreakdown, pathAreaResolutions);
  const areaSummaries = buildAreaSummaries({
    hourlyBuckets: hourlyBreakdown,
    worktreeSummaries,
    orderedAreaKeys: areas.map((area) => area.label),
  });

  return {
    date: date.toISOString().split("T")[0],
    totalSeconds,
    hourlyBreakdown,
    worktreeSummaries,
    areaSummaries,
  };
};
