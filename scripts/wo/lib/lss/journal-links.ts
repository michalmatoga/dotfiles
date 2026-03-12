import { readFile, writeFile } from "node:fs/promises";

import { canonicalizeTrelloUrl, extractTrelloUrl } from "./tasks";

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
