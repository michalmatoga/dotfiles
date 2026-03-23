import { readFile, writeFile } from "node:fs/promises";

import { GOAL_SECTION_HEADING, canonicalizeTrelloUrl, extractTrelloUrl } from "./tasks";

const normalizeHeading = (value: string): string => value.trim().toLowerCase();
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();
const weekHeadingPattern = /^week\s+(\d{1,2})\b/i;
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

type PlanningHeading = {
  index: number;
  level: number;
  title: string;
  normalizedTitle: string;
  path: string[];
  normalizedPath: string[];
};

const buildCheckboxLine = (options: {
  indent: string;
  marker: string;
  state: string;
  text: string;
}): string => `${options.indent}${options.marker} [${options.state}] ${options.text}`;

const stripTrelloUrls = (value: string): string =>
  value.replace(/https?:\/\/trello\.com\/c\/[A-Za-z0-9][^\s)]*/gi, " ").replace(/\s+/g, " ").trim();

const stripMarkdownLinkWrapper = (value: string): string =>
  value.replace(/^\[(.+)\]\(https?:\/\/trello\.com\/c\/[A-Za-z0-9][^)]+\)$/i, "$1").trim();

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

const resolveGoalSectionRange = (lines: string[]): { start: number; end: number } | null => {
  let goalStart = -1;
  let goalEnd = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const headingMatch = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }
    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    if (level === 2 && normalizeHeading(title) === GOAL_SECTION_HEADING) {
      goalStart = index;
      continue;
    }
    if (goalStart !== -1 && level <= 2) {
      goalEnd = index;
      break;
    }
  }

  if (goalStart === -1) {
    return null;
  }
  return { start: goalStart, end: goalEnd };
};

const collectPlanningHeadings = (options: {
  lines: string[];
  start: number;
  end: number;
}): PlanningHeading[] => {
  const stack: Array<{ level: number; title: string; normalized: string }> = [];
  const headings: PlanningHeading[] = [];

  for (let index = options.start + 1; index < options.end; index++) {
    const headingMatch = options.lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }
    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    const normalized = normalizeHeading(title);
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, title, normalized });
    if (level < 3) {
      continue;
    }
    const scoped = stack.filter((entry) => entry.level >= 3);
    headings.push({
      index,
      level,
      title,
      normalizedTitle: normalized,
      path: scoped.map((entry) => entry.title),
      normalizedPath: scoped.map((entry) => entry.normalized),
    });
  }

  return headings;
};

const findSubtreeEnd = (options: {
  lines: string[];
  goalEnd: number;
  headingIndex: number;
  headingLevel: number;
}): number => {
  let subtreeEnd = options.goalEnd;
  for (let index = options.headingIndex + 1; index < options.goalEnd; index++) {
    const headingMatch = options.lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }
    const level = headingMatch[1].length;
    if (level <= options.headingLevel) {
      subtreeEnd = index;
      break;
    }
  }
  return subtreeEnd;
};

const findInsertionIndexUnderHeading = (options: {
  lines: string[];
  goalEnd: number;
  headingIndex: number;
  headingLevel: number;
}): number => {
  const subtreeEnd = findSubtreeEnd(options);
  let insertionIndex = subtreeEnd;
  for (let index = options.headingIndex + 1; index < subtreeEnd; index++) {
    if (/^\s*[-*]\s+\[[ xX]\]\s+.+$/.test(options.lines[index])) {
      insertionIndex = index + 1;
    }
  }
  return insertionIndex;
};

const resolveDeepestPlanningHeading = (headings: PlanningHeading[]): PlanningHeading | null => {
  let target: PlanningHeading | null = null;
  for (const heading of headings) {
    if (!target || heading.level >= target.level) {
      target = heading;
    }
  }
  return target;
};

const sharedPrefixLength = (left: string[], right: string[]): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return length;
};

const resolveRecurringSlotHeading = (options: {
  headings: PlanningHeading[];
  due: string | null | undefined;
  sourceHeadingPath?: string[];
}): PlanningHeading | null => {
  const sourcePath = (options.sourceHeadingPath ?? []).map((segment) => normalizeHeading(segment));
  const dueDate = options.due ? new Date(options.due) : null;
  const hasValidDue = Boolean(dueDate && !Number.isNaN(dueDate.getTime()));

  if (hasValidDue && dueDate) {
    const targetWeek = getIsoWeekNumber(dueDate);
    const targetYear = String(dueDate.getFullYear());
    const targetMonth = monthNameByNumber[dueDate.getMonth()] ?? "";
    const weekCandidates = options.headings.filter((heading) => {
      const match = heading.normalizedTitle.match(weekHeadingPattern);
      if (!match) {
        return false;
      }
      const week = Number.parseInt(match[1], 10);
      return Number.isInteger(week) && week === targetWeek;
    });
    if (weekCandidates.length > 0) {
      return [...weekCandidates].sort((left, right) => {
        const leftYear = left.normalizedPath.includes(targetYear) ? 1 : 0;
        const rightYear = right.normalizedPath.includes(targetYear) ? 1 : 0;
        if (leftYear !== rightYear) {
          return rightYear - leftYear;
        }
        const leftMonth = left.normalizedPath.includes(targetMonth) ? 1 : 0;
        const rightMonth = right.normalizedPath.includes(targetMonth) ? 1 : 0;
        if (leftMonth !== rightMonth) {
          return rightMonth - leftMonth;
        }
        const leftPrefix = sharedPrefixLength(sourcePath, left.normalizedPath);
        const rightPrefix = sharedPrefixLength(sourcePath, right.normalizedPath);
        if (leftPrefix !== rightPrefix) {
          return rightPrefix - leftPrefix;
        }
        return left.index - right.index;
      })[0] ?? null;
    }

    const monthCandidate = options.headings.find((heading) => heading.normalizedTitle === targetMonth);
    if (monthCandidate) {
      return monthCandidate;
    }

    const yearCandidate = options.headings.find((heading) => heading.normalizedTitle === targetYear);
    if (yearCandidate) {
      return yearCandidate;
    }
  }

  for (let length = sourcePath.length; length > 0; length--) {
    const prefix = sourcePath.slice(0, length);
    const exact = options.headings.find((heading) =>
      heading.normalizedPath.length === prefix.length
      && heading.normalizedPath.every((segment, index) => segment === prefix[index])
    );
    if (exact) {
      return exact;
    }
  }

  return resolveDeepestPlanningHeading(options.headings);
};

export const injectTrelloUrlIntoTaskLine = async (options: {
  filePath: string;
  line: number;
  trelloUrl: string;
}): Promise<{ updated: boolean; reason?: string }> => {
  const canonicalUrl = canonicalizeTrelloUrl(options.trelloUrl);
  if (!canonicalUrl) {
    return { updated: false, reason: "invalid-url" };
  }

  const content = await readFile(options.filePath, "utf8");
  const lines = content.split("\n");
  const index = options.line - 1;
  if (index < 0 || index >= lines.length) {
    return { updated: false, reason: "line-out-of-range" };
  }

  const current = lines[index];
  const match = current.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) {
    return { updated: false, reason: "not-checkbox-task" };
  }

  const [, indent, marker, state, rawText] = match;
  const existingUrl = canonicalizeTrelloUrl(extractTrelloUrl(rawText) ?? "");
  const urlToUse = existingUrl ?? canonicalUrl;
  const plainText = stripTrelloUrls(stripMarkdownLinkWrapper(rawText));
  if (!plainText) {
    return { updated: false, reason: "empty-task-text" };
  }
  const nextText = `[${plainText}](${urlToUse})`;
  const nextLine = buildCheckboxLine({
    indent,
    marker,
    state: state.toLowerCase() === "x" ? "x" : " ",
    text: nextText,
  });
  if (nextLine === current) {
    return { updated: false, reason: "already-linked" };
  }
  lines[index] = nextLine;
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return { updated: true };
};

export const setTaskCheckboxStateAtLine = async (options: {
  filePath: string;
  line: number;
  checked: boolean;
}): Promise<{ updated: boolean; reason?: string }> => {
  const content = await readFile(options.filePath, "utf8");
  const lines = content.split("\n");
  const index = options.line - 1;
  if (index < 0 || index >= lines.length) {
    return { updated: false, reason: "line-out-of-range" };
  }

  const current = lines[index];
  const match = current.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) {
    return { updated: false, reason: "not-checkbox-task" };
  }

  const [, indent, marker, state, text] = match;
  const currentChecked = state.toLowerCase() === "x";
  if (currentChecked === options.checked) {
    return { updated: false, reason: "already-matching" };
  }

  lines[index] = buildCheckboxLine({
    indent,
    marker,
    state: options.checked ? "x" : " ",
    text,
  });
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return { updated: true };
};

export const appendTaskUnderDeepestPlanningHeading = async (options: {
  filePath: string;
  text: string;
  trelloUrl: string;
}): Promise<{ updated: boolean; line?: number; reason?: string }> => {
  const canonicalUrl = canonicalizeTrelloUrl(options.trelloUrl);
  if (!canonicalUrl) {
    return { updated: false, reason: "invalid-url" };
  }
  const taskText = options.text.replace(/\s+/g, " ").trim();
  if (!taskText) {
    return { updated: false, reason: "empty-task-text" };
  }

  const content = await readFile(options.filePath, "utf8");
  const lines = content.split("\n");

  for (const line of lines) {
    const lineUrl = canonicalizeTrelloUrl(extractTrelloUrl(line) ?? "");
    if (lineUrl === canonicalUrl) {
      return { updated: false, reason: "already-linked" };
    }
  }

  const goalRange = resolveGoalSectionRange(lines);
  if (!goalRange) {
    return { updated: false, reason: "missing-goal-section" };
  }

  const headings = collectPlanningHeadings({
    lines,
    start: goalRange.start,
    end: goalRange.end,
  });
  const target = resolveDeepestPlanningHeading(headings);
  if (!target) {
    return { updated: false, reason: "missing-planning-heading" };
  }

  const insertionIndex = findInsertionIndexUnderHeading({
    lines,
    goalEnd: goalRange.end,
    headingIndex: target.index,
    headingLevel: target.level,
  });

  const taskLine = `- [ ] [${taskText}](${canonicalUrl})`;
  lines.splice(insertionIndex, 0, taskLine);
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return { updated: true, line: insertionIndex + 1 };
};

export const convertTaskCheckboxToRecurringHistoryAtLine = async (options: {
  filePath: string;
  line: number;
  doneDate: string;
}): Promise<{ updated: boolean; text?: string; trelloUrl?: string; reason?: string }> => {
  const content = await readFile(options.filePath, "utf8");
  const lines = content.split("\n");
  const index = options.line - 1;
  if (index < 0 || index >= lines.length) {
    return { updated: false, reason: "line-out-of-range" };
  }

  const current = lines[index];
  const match = current.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) {
    return { updated: false, reason: "not-checkbox-task" };
  }

  const [, indent, marker, , rawText] = match;
  const trelloUrl = canonicalizeTrelloUrl(extractTrelloUrl(rawText) ?? "");
  if (!trelloUrl) {
    return { updated: false, reason: "missing-trello-url" };
  }
  const text = stripTrelloUrls(stripMarkdownLinkWrapper(rawText));
  if (!text) {
    return { updated: false, reason: "empty-task-text" };
  }
  const doneDate = normalizeWhitespace(options.doneDate);
  if (!doneDate) {
    return { updated: false, reason: "empty-done-date" };
  }

  const nextLine = `${indent}${marker} ✅ [${text}](${trelloUrl}) (done ${doneDate})`;
  if (nextLine === current) {
    return { updated: false, reason: "already-history" };
  }

  lines[index] = nextLine;
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return {
    updated: true,
    text,
    trelloUrl,
  };
};

export const appendRecurringTaskUnderClosestPlanningSlot = async (options: {
  filePath: string;
  text: string;
  trelloUrl: string;
  due: string | null | undefined;
  sourceHeadingPath?: string[];
}): Promise<{ updated: boolean; line?: number; reason?: string }> => {
  const canonicalUrl = canonicalizeTrelloUrl(options.trelloUrl);
  if (!canonicalUrl) {
    return { updated: false, reason: "invalid-url" };
  }
  const taskText = normalizeWhitespace(options.text);
  if (!taskText) {
    return { updated: false, reason: "empty-task-text" };
  }

  const content = await readFile(options.filePath, "utf8");
  const lines = content.split("\n");

  for (const line of lines) {
    if (!/^\s*[-*]\s+\[[ xX]\]\s+.+$/.test(line)) {
      continue;
    }
    const lineUrl = canonicalizeTrelloUrl(extractTrelloUrl(line) ?? "");
    if (lineUrl === canonicalUrl) {
      return { updated: false, reason: "already-linked" };
    }
  }

  const goalRange = resolveGoalSectionRange(lines);
  if (!goalRange) {
    return { updated: false, reason: "missing-goal-section" };
  }

  const headings = collectPlanningHeadings({
    lines,
    start: goalRange.start,
    end: goalRange.end,
  });
  const target = resolveRecurringSlotHeading({
    headings,
    due: options.due,
    sourceHeadingPath: options.sourceHeadingPath,
  });
  if (!target) {
    return { updated: false, reason: "missing-planning-heading" };
  }

  const insertionIndex = findInsertionIndexUnderHeading({
    lines,
    goalEnd: goalRange.end,
    headingIndex: target.index,
    headingLevel: target.level,
  });

  const taskLine = `- [ ] [${taskText}](${canonicalUrl})`;
  lines.splice(insertionIndex, 0, taskLine);
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return { updated: true, line: insertionIndex + 1 };
};
