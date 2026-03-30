import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type GoalRangeId = "today" | "this-week" | "last-7d" | "this-month" | "all";

const goalRangeIds: GoalRangeId[] = ["today", "this-week", "last-7d", "this-month", "all"];

export type GoalRangeSnippet = {
  markdown: string;
  matchedHeading: string | null;
  hasContent: boolean;
};

export type GoalNoteSourceConfig = {
  id: string;
  title: string;
  notePath: string;
  labels: string[];
};

export type GoalNoteSourceData = GoalNoteSourceConfig & {
  byRange: Record<GoalRangeId, GoalRangeSnippet>;
  byRangeOffset?: Partial<Record<GoalRangeId, Record<string, GoalRangeSnippet>>>;
};

export type GoalTrackingData = {
  generatedAt: string;
  sources: GoalNoteSourceData[];
};

const goalSectionHeading = "goal setting to the now";
const monthNameByNumber = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const normalizeHeading = (value: string): string => value.trim().toLowerCase();

const getIsoWeekNumber = (value: Date): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + 3);

  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setHours(0, 0, 0, 0);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, week);
};

const sectionNotFound = (): GoalRangeSnippet => ({
  markdown: "_Goal section not found in note._",
  matchedHeading: null,
  hasContent: false,
});

const loadErrorSnippet = (message: string): GoalRangeSnippet => ({
  markdown: `_Could not load note: ${message}_`,
  matchedHeading: null,
  hasContent: false,
});

const blockToSnippet = (markdown: string, matchedHeading: string | null): GoalRangeSnippet => ({
  markdown,
  matchedHeading,
  hasContent: markdown.trim().length > 0,
});

type HeadingBlock = {
  level: number;
  title: string;
  startIndex: number;
  markdown: string;
};

const extractGoalSection = (markdown: string): string[] | null => {
  const lines = markdown.split("\n");
  let startIndex = -1;

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    if (normalizeHeading(match[1]) === goalSectionHeading) {
      startIndex = index;
      break;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,2})\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    endIndex = index;
    break;
  }

  return lines.slice(startIndex, endIndex);
};

const extractHeadingBlocks = (sectionLines: string[]): HeadingBlock[] => {
  const headings: Array<{ level: number; title: string; startIndex: number }> = [];
  for (let index = 0; index < sectionLines.length; index++) {
    const match = sectionLines[index].match(/^(#{3,6})\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    headings.push({ level: match[1].length, title: match[2].trim(), startIndex: index });
  }

  const blocks: HeadingBlock[] = [];
  for (let index = 0; index < headings.length; index++) {
    const current = headings[index];
    let end = sectionLines.length;
    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex++) {
      const next = headings[nextIndex];
      if (next.level <= current.level) {
        end = next.startIndex;
        break;
      }
    }
    blocks.push({
      level: current.level,
      title: current.title,
      startIndex: current.startIndex,
      markdown: sectionLines.slice(current.startIndex, end).join("\n").trim(),
    });
  }

  return blocks;
};

const selectMonthBlock = (blocks: HeadingBlock[], referenceNow: Date): HeadingBlock | null => {
  const targetMonthIndex = referenceNow.getMonth();
  const monthBlocks = blocks
    .map((block) => {
      const monthIndex = monthNameByNumber.indexOf(normalizeHeading(block.title));
      return { block, monthIndex };
    })
    .filter((entry) => entry.monthIndex >= 0);

  if (monthBlocks.length === 0) {
    return null;
  }

  const exact = monthBlocks.find((entry) => entry.monthIndex === targetMonthIndex);
  if (exact) {
    return exact.block;
  }

  const previousOrCurrent = monthBlocks
    .filter((entry) => entry.monthIndex <= targetMonthIndex)
    .sort((a, b) => b.monthIndex - a.monthIndex)[0];
  if (previousOrCurrent) {
    return previousOrCurrent.block;
  }

  return monthBlocks[monthBlocks.length - 1]?.block ?? null;
};

const selectWeekBlock = (blocks: HeadingBlock[], referenceNow: Date): HeadingBlock | null => {
  const targetWeek = getIsoWeekNumber(referenceNow);
  const weekBlocks = blocks
    .map((block) => {
      const match = block.title.match(/\bweek\s+(\d{1,2})\b/i);
      return {
        block,
        week: match ? parseInt(match[1], 10) : NaN,
      };
    })
    .filter((entry) => Number.isFinite(entry.week));

  if (weekBlocks.length === 0) {
    return null;
  }

  const exact = weekBlocks.find((entry) => entry.week === targetWeek);
  if (exact) {
    return exact.block;
  }

  let best: typeof weekBlocks[number] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of weekBlocks) {
    const delta = Math.abs(candidate.week - targetWeek);
    const futurePenalty = candidate.week > targetWeek ? 100 : 0;
    const score = futurePenalty + delta;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best?.block ?? null;
};

const selectTodayBlock = (blocks: HeadingBlock[]): HeadingBlock | null =>
  blocks.find((block) => normalizeHeading(block.title) === "today") ?? null;

const addLocalDays = (value: Date, days: number): Date => {
  const date = new Date(value.getTime());
  date.setDate(date.getDate() + days);
  return date;
};

const addLocalMonths = (value: Date, months: number): Date => {
  const date = new Date(value.getTime());
  date.setMonth(date.getMonth() + months);
  return date;
};

const shiftReferenceNowForRange = (referenceNow: Date, rangeId: GoalRangeId, offset: number): Date => {
  if (!Number.isFinite(offset) || offset === 0 || rangeId === "all") {
    return new Date(referenceNow.getTime());
  }
  if (rangeId === "this-week" || rangeId === "last-7d") {
    return addLocalDays(referenceNow, offset * 7);
  }
  if (rangeId === "this-month") {
    return addLocalMonths(referenceNow, offset);
  }
  return addLocalDays(referenceNow, offset);
};

export const buildGoalRangeSnippetsFromMarkdown = (
  markdown: string,
  referenceNow: Date,
): Record<GoalRangeId, GoalRangeSnippet> => {
  const sectionLines = extractGoalSection(markdown);
  if (!sectionLines) {
    const missing = sectionNotFound();
    return {
      today: missing,
      "this-week": missing,
      "last-7d": missing,
      "this-month": missing,
      all: missing,
    };
  }

  const sectionMarkdown = sectionLines.join("\n").trim();
  const blocks = extractHeadingBlocks(sectionLines);
  const todayBlock = selectTodayBlock(blocks);
  const monthBlock = selectMonthBlock(blocks, referenceNow);
  const weekBlock = selectWeekBlock(blocks, referenceNow);

  const monthSnippet = monthBlock
    ? blockToSnippet(monthBlock.markdown, monthBlock.title)
    : blockToSnippet(sectionMarkdown, "Goal Setting to the Now");
  const weekSnippet = weekBlock
    ? blockToSnippet(weekBlock.markdown, weekBlock.title)
    : monthBlock
      ? blockToSnippet(monthBlock.markdown, monthBlock.title)
      : blockToSnippet(sectionMarkdown, "Goal Setting to the Now");
  const todaySnippet = todayBlock
    ? blockToSnippet(todayBlock.markdown, todayBlock.title)
    : weekSnippet;
  const allSnippet = blockToSnippet(sectionMarkdown, "Goal Setting to the Now");

  return {
    today: todaySnippet,
    "this-week": weekSnippet,
    "last-7d": weekSnippet,
    "this-month": monthSnippet,
    all: allSnippet,
  };
};

export const buildGoalTrackingData = async (options: {
  now: Date;
  sources: GoalNoteSourceConfig[];
  offsetWindow?: number;
}): Promise<GoalTrackingData> => {
  const sources: GoalNoteSourceData[] = [];
  const offsetWindow = Math.max(0, Math.floor(Number(options.offsetWindow) || 0));

  for (const source of options.sources) {
    try {
      const markdown = await readFile(source.notePath, "utf8");
      const byRange = buildGoalRangeSnippetsFromMarkdown(markdown, options.now);
      const byRangeOffset: Partial<Record<GoalRangeId, Record<string, GoalRangeSnippet>>> = {};
      if (offsetWindow > 0) {
        for (const rangeId of goalRangeIds) {
          const snippetsByOffset: Record<string, GoalRangeSnippet> = {};
          for (let offset = -offsetWindow; offset <= offsetWindow; offset++) {
            const shiftedNow = shiftReferenceNowForRange(options.now, rangeId, offset);
            const shiftedSnippets = buildGoalRangeSnippetsFromMarkdown(markdown, shiftedNow);
            snippetsByOffset[String(offset)] = shiftedSnippets[rangeId];
          }
          byRangeOffset[rangeId] = snippetsByOffset;
        }
      }
      sources.push({
        ...source,
        labels: source.labels.map((label) => label.trim().toLowerCase()).filter((label) => label.length > 0),
        byRange,
        byRangeOffset,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = loadErrorSnippet(message);
      sources.push({
        ...source,
        labels: source.labels.map((label) => label.trim().toLowerCase()).filter((label) => label.length > 0),
        byRange: {
          today: failure,
          "this-week": failure,
          "last-7d": failure,
          "this-month": failure,
          all: failure,
        },
      });
    }
  }

  return {
    generatedAt: options.now.toISOString(),
    sources,
  };
};

const defaultJournalPath = process.env.WO_JOURNAL_PATH ?? "/home/nixos/ghq/gitlab.com/michalmatoga/journal";

export const defaultGoalTrackingSources: GoalNoteSourceConfig[] = [
  {
    id: "business",
    title: "OT Business",
    notePath: join(defaultJournalPath, "ot-business.md"),
    labels: ["business"],
  },
  {
    id: "career",
    title: "OT Career",
    notePath: join(defaultJournalPath, "ot-career.md"),
    labels: ["career", "career-delivery", "review"],
  },
  {
    id: "health",
    title: "OT Health",
    notePath: join(defaultJournalPath, "ot-health.md"),
    labels: ["health"],
  },
  {
    id: "growth",
    title: "Growth",
    notePath: join(defaultJournalPath, "growth.md"),
    labels: ["growth"],
  },
  {
    id: "household",
    title: "Household",
    notePath: join(defaultJournalPath, "household.md"),
    labels: ["household"],
  },
  {
    id: "relationships",
    title: "OT Relations",
    notePath: join(defaultJournalPath, "ot-relations.md"),
    labels: ["relationships"],
  },
];
