import { listAliases, listNames } from "../policy/mapping";

import type { LssInitiative } from "./tasks";

export type LssManagedCardState = {
  cardId: string;
  trelloUrl: string;
  listId: string;
};

export type LssCheckboxPatch = {
  noteId: string;
  filePath: string;
  line: number;
  checked: boolean;
  trelloUrl: string;
  cardId: string;
  listId: string;
};

export type LssMirrorConflict = {
  trelloUrl: string;
  reason: "multiple-cards" | "multiple-tasks";
  cardIds: string[];
  taskRefs: Array<{ noteId: string; line: number }>;
};

export type LssMirrorMarker = {
  cardId: string | null;
  listId: string | null;
  journalChecked: boolean | null;
  noteId: string | null;
  line: number | null;
  conflict: boolean;
};

export type LssCheckboxMirrorPlan = {
  patches: LssCheckboxPatch[];
  conflicts: LssMirrorConflict[];
  warnings: string[];
  markersByUrl: Record<string, LssMirrorMarker>;
};

const canonicalListName = (listById: Map<string, string>, listId: string): string | null => {
  const raw = listById.get(listId);
  if (!raw) {
    return null;
  }
  return listAliases[raw] ?? raw;
};

const isDoneList = (listById: Map<string, string>, listId: string): boolean =>
  canonicalListName(listById, listId) === listNames.done;

export const planLssCheckboxMirror = (options: {
  initiatives: LssInitiative[];
  managedCards: LssManagedCardState[];
  listById: Map<string, string>;
}): LssCheckboxMirrorPlan => {
  const patches: LssCheckboxPatch[] = [];
  const conflicts: LssMirrorConflict[] = [];
  const warnings: string[] = [];
  const markersByUrl: Record<string, LssMirrorMarker> = {};

  const cardsByUrl = new Map<string, LssManagedCardState[]>();
  for (const card of options.managedCards) {
    const existing = cardsByUrl.get(card.trelloUrl) ?? [];
    existing.push(card);
    cardsByUrl.set(card.trelloUrl, existing);
  }

  const tasksByUrl = new Map<string, LssInitiative[]>();
  for (const initiative of options.initiatives) {
    if (!initiative.trelloUrl) {
      continue;
    }
    const existing = tasksByUrl.get(initiative.trelloUrl) ?? [];
    existing.push(initiative);
    tasksByUrl.set(initiative.trelloUrl, existing);
  }

  const sortedUrls = [...cardsByUrl.keys()].sort((a, b) => a.localeCompare(b));
  for (const trelloUrl of sortedUrls) {
    const cardMatches = cardsByUrl.get(trelloUrl) ?? [];
    const taskMatches = tasksByUrl.get(trelloUrl) ?? [];

    if (cardMatches.length > 1) {
      const conflict: LssMirrorConflict = {
        trelloUrl,
        reason: "multiple-cards",
        cardIds: cardMatches.map((card) => card.cardId),
        taskRefs: taskMatches.map((task) => ({ noteId: task.noteId, line: task.line })),
      };
      conflicts.push(conflict);
      warnings.push(`Conflict (multiple managed cards) for ${trelloUrl}`);
      markersByUrl[trelloUrl] = {
        cardId: null,
        listId: null,
        journalChecked: null,
        noteId: null,
        line: null,
        conflict: true,
      };
      continue;
    }

    const card = cardMatches[0];
    if (!card) {
      continue;
    }

    if (taskMatches.length > 1) {
      const conflict: LssMirrorConflict = {
        trelloUrl,
        reason: "multiple-tasks",
        cardIds: [card.cardId],
        taskRefs: taskMatches.map((task) => ({ noteId: task.noteId, line: task.line })),
      };
      conflicts.push(conflict);
      warnings.push(`Conflict (same Trello URL in multiple tasks) for ${trelloUrl}`);
      markersByUrl[trelloUrl] = {
        cardId: card.cardId,
        listId: card.listId,
        journalChecked: null,
        noteId: null,
        line: null,
        conflict: true,
      };
      continue;
    }

    const target = taskMatches[0] ?? null;
    const desiredChecked = isDoneList(options.listById, card.listId);

    markersByUrl[trelloUrl] = {
      cardId: card.cardId,
      listId: card.listId,
      journalChecked: desiredChecked,
      noteId: target?.noteId ?? null,
      line: target?.line ?? null,
      conflict: false,
    };

    if (!target) {
      continue;
    }

    if (target.checked !== desiredChecked) {
      patches.push({
        noteId: target.noteId,
        filePath: target.filePath,
        line: target.line,
        checked: desiredChecked,
        trelloUrl,
        cardId: card.cardId,
        listId: card.listId,
      });
    }
  }

  patches.sort((a, b) => {
    if (a.noteId !== b.noteId) {
      return a.noteId.localeCompare(b.noteId);
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.trelloUrl.localeCompare(b.trelloUrl);
  });

  return {
    patches,
    conflicts,
    warnings,
    markersByUrl,
  };
};
