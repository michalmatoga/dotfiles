import { readFile, writeFile } from "node:fs/promises";

import { GOAL_SECTION_HEADING, canonicalizeTrelloUrl, extractTrelloUrl } from "./tasks";

const normalizeHeading = (value: string): string => value.trim().toLowerCase();

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
    return { updated: false, reason: "missing-goal-section" };
  }

  let targetHeadingIndex = -1;
  let targetHeadingLevel = -1;
  for (let index = goalStart + 1; index < goalEnd; index++) {
    const headingMatch = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }
    const level = headingMatch[1].length;
    if (level < 3) {
      continue;
    }
    if (level > targetHeadingLevel || level === targetHeadingLevel) {
      targetHeadingIndex = index;
      targetHeadingLevel = level;
    }
  }

  if (targetHeadingIndex === -1 || targetHeadingLevel < 3) {
    return { updated: false, reason: "missing-planning-heading" };
  }

  let subtreeEnd = goalEnd;
  for (let index = targetHeadingIndex + 1; index < goalEnd; index++) {
    const headingMatch = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }
    const level = headingMatch[1].length;
    if (level <= targetHeadingLevel) {
      subtreeEnd = index;
      break;
    }
  }

  let insertionIndex = subtreeEnd;
  for (let index = targetHeadingIndex + 1; index < subtreeEnd; index++) {
    if (/^\s*[-*]\s+\[[ xX]\]\s+.+$/.test(lines[index])) {
      insertionIndex = index + 1;
    }
  }

  const taskLine = `- [ ] [${taskText}](${canonicalUrl})`;
  lines.splice(insertionIndex, 0, taskLine);
  await writeFile(options.filePath, lines.join("\n"), "utf8");
  return { updated: true, line: insertionIndex + 1 };
};
