import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LssArea } from "../trello/lss-areas";
import { listAliases, listNames } from "../policy/mapping";

export const DEFAULT_JOURNAL_PATH = "/home/nixos/ghq/gitlab.com/michalmatoga/journal";
export const GOAL_SECTION_HEADING = "goal setting to the now";

type Heading = {
  level: number;
  title: string;
};

type TaskIdentity = {
  key: string;
  kind: "trello-url" | "note-text";
};

export type LssInitiative = {
  noteId: string;
  filePath: string;
  headingPath: string[];
  line: number;
  checked: boolean;
  text: string;
  trelloUrl: string | null;
  identity: TaskIdentity;
  conflict: boolean;
  repoLabel: string | null;
  repoLabelConflict: boolean;
  repoLabelCandidates: string[];
};

export type LssTaskParseWarning = {
  noteId: string;
  filePath: string;
  message: string;
};

export type LssTaskParseResult = {
  initiatives: LssInitiative[];
  warnings: LssTaskParseWarning[];
};

type LssRepoLabelResolution =
  | { status: "none" }
  | { status: "single"; label: string }
  | { status: "multiple"; labels: string[] };

export type LssPlannerCard = {
  id: string;
  name: string;
  idList: string;
  trelloUrl: string | null;
  noteId: string | null;
};

export type LssPlannedAction = {
  type: "create" | "link" | "update-title" | "check" | "uncheck" | "conflict-skip";
  noteId: string;
  line: number;
  text: string;
  trelloUrl: string | null;
  cardId: string | null;
  reason: string;
};

export type LssPlanResult = {
  actions: LssPlannedAction[];
  warnings: string[];
};

export type LssBackfillAction = {
  type: "backfill-journal";
  cardId: string;
  noteId: string;
  filePath: string;
  text: string;
  trelloUrl: string;
  reason: string;
};

export type LssBackfillPlanResult = {
  actions: LssBackfillAction[];
  warnings: string[];
};

const normalizeHeading = (value: string): string => value.trim().toLowerCase();

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const canonicalizeTrelloUrl = (value: string): string | null => {
  const match = value.match(/https?:\/\/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (!match) {
    return null;
  }
  return `https://trello.com/c/${match[1]}`;
};

export const extractTrelloUrl = (value: string): string | null => {
  const matches = value.match(/https?:\/\/trello\.com\/c\/[A-Za-z0-9][^\s)]*/gi);
  if (!matches || matches.length === 0) {
    return null;
  }
  for (const candidate of matches) {
    const canonical = canonicalizeTrelloUrl(candidate);
    if (canonical) {
      return canonical;
    }
  }
  return null;
};

const stripTrelloUrls = (value: string): string =>
  value.replace(/https?:\/\/trello\.com\/c\/[A-Za-z0-9][^\s)]*/gi, " ");

const stripMarkdownLinks = (value: string): string =>
  value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const parseInitiativeText = (value: string): string => {
  const withoutLinks = stripMarkdownLinks(value);
  const withoutTrelloUrls = stripTrelloUrls(withoutLinks);
  return normalizeWhitespace(withoutTrelloUrls);
};

export const normalizeTaskText = (value: string): string => {
  const withoutFormatting = parseInitiativeText(value).replace(/[`*_~]/g, "");
  return normalizeWhitespace(withoutFormatting).toLowerCase();
};

export const resolveLssAreaNotePath = (options: {
  noteId: string;
  journalPath: string;
}): string => join(options.journalPath, `${options.noteId}.md`);

const buildIdentity = (options: { noteId: string; text: string; trelloUrl: string | null }): TaskIdentity => {
  if (options.trelloUrl) {
    return {
      kind: "trello-url",
      key: options.trelloUrl,
    };
  }
  return {
    kind: "note-text",
    key: `${options.noteId}::${normalizeTaskText(options.text)}`,
  };
};

const stripWrappedQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseFrontmatterTags = (markdown: string): string[] => {
  const lines = markdown.split("\n");
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return [];
  }

  let end = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return [];
  }

  const tags: string[] = [];
  for (let index = 1; index < end; index++) {
    const line = lines[index];
    const match = line.match(/^\s*tags\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const rest = match[1].trim();
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inline = rest.slice(1, -1).trim();
      if (!inline) {
        return [];
      }
      return inline
        .split(",")
        .map((item) => stripWrappedQuotes(item))
        .filter(Boolean);
    }

    if (rest) {
      return [stripWrappedQuotes(rest)].filter(Boolean);
    }

    for (let listIndex = index + 1; listIndex < end; listIndex++) {
      const listLine = lines[listIndex];
      if (!listLine.trim()) {
        continue;
      }
      const listMatch = listLine.match(/^\s*-\s*(.+?)\s*$/);
      if (!listMatch) {
        break;
      }
      tags.push(stripWrappedQuotes(listMatch[1]));
      index = listIndex;
    }
    return tags.filter(Boolean);
  }

  return [];
};

export const resolveRepoLabelFromFrontmatter = (markdown: string): LssRepoLabelResolution => {
  const rawTags = parseFrontmatterTags(markdown);
  const repoLabels = [...new Set(
    rawTags
      .map((tag) => tag.match(/^repo-(.+)$/)?.[1]?.trim() ?? null)
      .filter((label): label is string => Boolean(label)),
  )];

  if (repoLabels.length === 0) {
    return { status: "none" };
  }

  if (repoLabels.length > 1) {
    return { status: "multiple", labels: repoLabels };
  }

  return { status: "single", label: repoLabels[0] };
};

export const parseLssInitiativesFromMarkdown = (options: {
  noteId: string;
  filePath: string;
  markdown: string;
}): LssInitiative[] => {
  const lines = options.markdown.split("\n");
  const headingStack: Heading[] = [];
  let sectionLevel: number | null = null;
  const initiatives: LssInitiative[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });

      if (sectionLevel !== null && level <= sectionLevel) {
        sectionLevel = null;
      }
      if (level === 2 && normalizeHeading(title) === GOAL_SECTION_HEADING) {
        sectionLevel = level;
      }
      continue;
    }

    if (sectionLevel === null) {
      continue;
    }
    const currentHeading = headingStack[headingStack.length - 1];
    if (!currentHeading || currentHeading.level < 3) {
      continue;
    }

    const taskMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!taskMatch) {
      continue;
    }

    const rawText = taskMatch[2].trim();
    const trelloUrl = extractTrelloUrl(rawText);
    const text = parseInitiativeText(rawText);
    initiatives.push({
      noteId: options.noteId,
      filePath: options.filePath,
      headingPath: headingStack.filter((entry) => entry.level >= 3).map((entry) => entry.title),
      line: index + 1,
      checked: taskMatch[1].toLowerCase() === "x",
      text,
      trelloUrl,
      identity: buildIdentity({ noteId: options.noteId, text, trelloUrl }),
      conflict: false,
      repoLabel: null,
      repoLabelConflict: false,
      repoLabelCandidates: [],
    });
  }

  const duplicateCounts = new Map<string, number>();
  for (const item of initiatives) {
    if (item.identity.kind !== "note-text") {
      continue;
    }
    duplicateCounts.set(item.identity.key, (duplicateCounts.get(item.identity.key) ?? 0) + 1);
  }

  return initiatives.map((item) => {
    if (item.identity.kind === "note-text" && (duplicateCounts.get(item.identity.key) ?? 0) > 1) {
      return {
        ...item,
        conflict: true,
      };
    }
    return item;
  });
};

export const loadLssInitiativesFromJournal = async (options: {
  areas: LssArea[];
  journalPath?: string;
}): Promise<LssTaskParseResult> => {
  const journalPath = options.journalPath ?? process.env.WO_JOURNAL_PATH ?? DEFAULT_JOURNAL_PATH;
  const warnings: LssTaskParseWarning[] = [];
  const initiatives: LssInitiative[] = [];

  for (const area of options.areas) {
    const filePath = resolveLssAreaNotePath({ noteId: area.noteId, journalPath });
    try {
      const markdown = await readFile(filePath, "utf8");
      const repoLabelResolution = resolveRepoLabelFromFrontmatter(markdown);
      if (repoLabelResolution.status === "multiple") {
        warnings.push({
          noteId: area.noteId,
          filePath,
          message: `Multiple repo tags found in note frontmatter: ${repoLabelResolution.labels.join(", ")}`,
        });
      }
      initiatives.push(
        ...parseLssInitiativesFromMarkdown({ noteId: area.noteId, filePath, markdown }).map((initiative) => ({
          ...initiative,
          repoLabel: repoLabelResolution.status === "single" ? repoLabelResolution.label : null,
          repoLabelConflict: repoLabelResolution.status === "multiple",
          repoLabelCandidates: repoLabelResolution.status === "multiple" ? repoLabelResolution.labels : [],
        })),
      );
    } catch (error) {
      warnings.push({
        noteId: area.noteId,
        filePath,
        message: `Unable to read note: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  for (const item of initiatives) {
    if (item.conflict) {
      warnings.push({
        noteId: item.noteId,
        filePath: item.filePath,
        message: `Ambiguous duplicate unlinked task skipped at line ${item.line}: ${item.text}`,
      });
    }
  }

  return {
    initiatives,
    warnings,
  };
};

const listNameForId = (listById: Map<string, string>, idList: string): string | null => {
  const raw = listById.get(idList);
  if (!raw) {
    return null;
  }
  return listAliases[raw] ?? raw;
};

const isDoneCard = (card: LssPlannerCard, listById: Map<string, string>): boolean =>
  listNameForId(listById, card.idList) === listNames.done;

const sortActions = (actions: LssPlannedAction[]): LssPlannedAction[] => {
  const rank: Record<LssPlannedAction["type"], number> = {
    "conflict-skip": 0,
    create: 1,
    link: 2,
    "update-title": 3,
    check: 4,
    uncheck: 5,
  };
  return [...actions].sort((a, b) => {
    if (a.noteId !== b.noteId) {
      return a.noteId.localeCompare(b.noteId);
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    if (rank[a.type] !== rank[b.type]) {
      return rank[a.type] - rank[b.type];
    }
    return a.text.localeCompare(b.text);
  });
};

export const derivePlannerCards = (options: {
  cards: Array<{
    id: string;
    name: string;
    idList: string;
    url?: string;
    shortUrl?: string;
    idLabels: string[];
  }>;
  labelNameById: Map<string, string>;
  areas: LssArea[];
}): LssPlannerCard[] => {
  const noteIdByAreaLabel = new Map(options.areas.map((area) => [area.label, area.noteId]));
  return options.cards.map((card) => {
    const areaNoteIds = card.idLabels
      .map((id) => options.labelNameById.get(id))
      .filter((name): name is string => Boolean(name))
      .map((name) => noteIdByAreaLabel.get(name))
      .filter((noteId): noteId is string => Boolean(noteId));
    const uniqueAreaNoteIds = [...new Set(areaNoteIds)];
    const trelloUrl = canonicalizeTrelloUrl(card.url ?? card.shortUrl ?? "");
    return {
      id: card.id,
      name: card.name,
      idList: card.idList,
      trelloUrl,
      noteId: uniqueAreaNoteIds.length === 1 ? uniqueAreaNoteIds[0] : null,
    };
  });
};

export const planLssInitiativeActions = (options: {
  initiatives: LssInitiative[];
  cards: LssPlannerCard[];
  listById: Map<string, string>;
}): LssPlanResult => {
  const actions: LssPlannedAction[] = [];
  const warnings: string[] = [];

  const cardByTrelloUrl = new Map<string, LssPlannerCard>();
  const cardsByFallback = new Map<string, LssPlannerCard[]>();
  for (const card of options.cards) {
    if (card.trelloUrl) {
      cardByTrelloUrl.set(card.trelloUrl, card);
    }
    if (!card.noteId) {
      continue;
    }
    const key = `${card.noteId}::${normalizeTaskText(card.name)}`;
    const existing = cardsByFallback.get(key) ?? [];
    existing.push(card);
    cardsByFallback.set(key, existing);
  }

  for (const item of options.initiatives) {
    if (item.conflict) {
      actions.push({
        type: "conflict-skip",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: null,
        cardId: null,
        reason: "ambiguous duplicate in note",
      });
      continue;
    }

    if (item.trelloUrl) {
      const card = cardByTrelloUrl.get(item.trelloUrl);
      if (!card) {
        actions.push({
          type: "conflict-skip",
          noteId: item.noteId,
          line: item.line,
          text: item.text,
          trelloUrl: item.trelloUrl,
          cardId: null,
          reason: "linked Trello card not found",
        });
        warnings.push(`Missing linked card for ${item.trelloUrl} (${item.noteId}:${item.line})`);
        continue;
      }
      if (normalizeWhitespace(card.name) !== normalizeWhitespace(item.text)) {
        actions.push({
          type: "update-title",
          noteId: item.noteId,
          line: item.line,
          text: item.text,
          trelloUrl: item.trelloUrl,
          cardId: card.id,
          reason: "journal text differs from card title",
        });
      }
      const done = isDoneCard(card, options.listById);
      if (item.checked && !done) {
        actions.push({
          type: "check",
          noteId: item.noteId,
          line: item.line,
          text: item.text,
          trelloUrl: item.trelloUrl,
          cardId: card.id,
          reason: "journal checked but card not in Done",
        });
      }
      if (!item.checked && done) {
        actions.push({
          type: "uncheck",
          noteId: item.noteId,
          line: item.line,
          text: item.text,
          trelloUrl: item.trelloUrl,
          cardId: card.id,
          reason: "journal unchecked but card is in Done",
        });
      }
      continue;
    }

    const fallbackKey = item.identity.key;
    const matches = cardsByFallback.get(fallbackKey) ?? [];
    if (matches.length > 1) {
      actions.push({
        type: "conflict-skip",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: null,
        cardId: null,
        reason: "multiple matching Trello cards",
      });
      warnings.push(`Ambiguous card match for ${item.noteId}:${item.line} (${item.text})`);
      continue;
    }
    if (matches.length === 0) {
      actions.push({
        type: "create",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: null,
        cardId: null,
        reason: "no existing Trello match",
      });
      continue;
    }

    const card = matches[0];
    actions.push({
      type: "link",
      noteId: item.noteId,
      line: item.line,
      text: item.text,
      trelloUrl: card.trelloUrl,
      cardId: card.id,
      reason: "matched existing Trello card by note/text",
    });
    if (normalizeWhitespace(card.name) !== normalizeWhitespace(item.text)) {
      actions.push({
        type: "update-title",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: card.trelloUrl,
        cardId: card.id,
        reason: "journal text differs from card title",
      });
    }
    const done = isDoneCard(card, options.listById);
    if (item.checked && !done) {
      actions.push({
        type: "check",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: card.trelloUrl,
        cardId: card.id,
        reason: "journal checked but card not in Done",
      });
    }
    if (!item.checked && done) {
      actions.push({
        type: "uncheck",
        noteId: item.noteId,
        line: item.line,
        text: item.text,
        trelloUrl: card.trelloUrl,
        cardId: card.id,
        reason: "journal unchecked but card is in Done",
      });
    }
  }

  return {
    actions: sortActions(actions),
    warnings,
  };
};

export const planLssJournalBackfillActions = (options: {
  initiatives: LssInitiative[];
  cards: Array<{
    id: string;
    name: string;
    desc: string;
    idLabels: string[];
    url?: string;
    shortUrl?: string;
  }>;
  labelNameById: Map<string, string>;
  areas: LssArea[];
  journalPath?: string;
}): LssBackfillPlanResult => {
  const warnings: string[] = [];
  const actions: LssBackfillAction[] = [];
  const journalPath = options.journalPath ?? process.env.WO_JOURNAL_PATH ?? DEFAULT_JOURNAL_PATH;

  const noteIdByAreaLabel = new Map(options.areas.map((area) => [area.label, area.noteId]));
  const existingByUrl = new Set(
    options.initiatives
      .map((initiative) => initiative.trelloUrl)
      .filter((url): url is string => Boolean(url)),
  );
  const existingByFallback = new Set(
    options.initiatives
      .filter((initiative) => initiative.identity.kind === "note-text")
      .map((initiative) => initiative.identity.key),
  );
  const candidateByFallback = new Map<string, string>();

  const cards = [...options.cards].sort((a, b) => a.id.localeCompare(b.id));
  for (const card of cards) {
    const cardLabelNames = card.idLabels
      .map((id) => options.labelNameById.get(id))
      .filter((name): name is string => Boolean(name));
    if (cardLabelNames.some((name) => name.toLowerCase() === "review")) {
      continue;
    }

    const trelloUrl = canonicalizeTrelloUrl(card.url ?? card.shortUrl ?? "");
    if (!trelloUrl) {
      warnings.push(`Skipping ${card.id}: card URL is missing or invalid`);
      continue;
    }

    const areaNoteIds = card.idLabels
      .map((id) => options.labelNameById.get(id))
      .filter((name): name is string => Boolean(name))
      .map((name) => noteIdByAreaLabel.get(name))
      .filter((noteId): noteId is string => Boolean(noteId));
    const uniqueAreaNoteIds = [...new Set(areaNoteIds)];
    if (uniqueAreaNoteIds.length !== 1) {
      if (uniqueAreaNoteIds.length > 1) {
        warnings.push(`Skipping ${card.id}: multiple mapped area labels (${[...new Set(cardLabelNames)].join(",")})`);
      }
      continue;
    }

    if (existingByUrl.has(trelloUrl)) {
      continue;
    }

    const noteId = uniqueAreaNoteIds[0];
    const fallbackKey = `${noteId}::${normalizeTaskText(card.name)}`;
    if (existingByFallback.has(fallbackKey)) {
      continue;
    }
    const previousCardId = candidateByFallback.get(fallbackKey);
    if (previousCardId) {
      warnings.push(
        `Skipping ${card.id}: ambiguous backfill match with ${previousCardId} (${noteId}, "${card.name}")`,
      );
      continue;
    }

    candidateByFallback.set(fallbackKey, card.id);
    existingByUrl.add(trelloUrl);
    existingByFallback.add(fallbackKey);
    actions.push({
      type: "backfill-journal",
      cardId: card.id,
      noteId,
      filePath: resolveLssAreaNotePath({ noteId, journalPath }),
      text: normalizeWhitespace(card.name),
      trelloUrl,
      reason: "board card missing in journal",
    });
  }

  actions.sort((a, b) => {
    if (a.noteId !== b.noteId) {
      return a.noteId.localeCompare(b.noteId);
    }
    return a.text.localeCompare(b.text);
  });

  return {
    actions,
    warnings,
  };
};
