import {
  derivePlannerCards,
  loadLssInitiativesFromJournal,
  planLssInitiativeActions,
  type LssInitiative,
} from "../lib/lss/tasks";
import { injectTrelloUrlIntoTaskLine } from "../lib/lss/journal-links";
import { listNames, labelNames } from "../lib/policy/mapping";
import { writeEvent } from "../lib/state/events";
import {
  formatSyncMetadata,
  parseSyncMetadata,
  updateDescriptionWithSync,
  extractDescriptionBase,
} from "../lib/sync/metadata";
import { createCard, fetchBoardCards, updateCard, type TrelloCard } from "../lib/trello/cards";
import { loadBoardContext } from "../lib/trello/context";
import { loadLssAreas } from "../lib/trello/lss-areas";

const buildInitiativeKey = (item: LssInitiative): string => `${item.noteId}:${item.line}`;

const resolveCardUrl = (card: { url?: string; shortUrl?: string } | null): string | null =>
  card?.url ?? card?.shortUrl ?? null;

const buildSyncBlock = (options: {
  initiative: LssInitiative;
  now: string;
  cardUrl: string | null;
}): string =>
  formatSyncMetadata({
    source: "lss",
    noteId: options.initiative.noteId,
    taskKey: options.initiative.identity.key,
    journalState: options.initiative.checked ? "checked" : "unchecked",
    lastSeen: options.now,
    url: options.cardUrl,
  });

const updateCardMetadata = async (options: {
  card: TrelloCard;
  initiative: LssInitiative;
  now: string;
}) => {
  const parsed = parseSyncMetadata(options.card.desc);
  const nextBlock = buildSyncBlock({
    initiative: options.initiative,
    now: options.now,
    cardUrl: resolveCardUrl(options.card),
  });
  const nextDesc = updateDescriptionWithSync(extractDescriptionBase(options.card.desc), nextBlock);
  const needsMetadataUpdate =
    parsed?.source !== "lss"
    || parsed?.noteId !== options.initiative.noteId
    || parsed?.taskKey !== options.initiative.identity.key
    || parsed?.journalState !== (options.initiative.checked ? "checked" : "unchecked")
    || parsed?.url !== resolveCardUrl(options.card)
    || parsed?.lastSeen !== options.now;

  if (!needsMetadataUpdate || nextDesc === options.card.desc) {
    return options.card;
  }

  return updateCard({
    cardId: options.card.id,
    desc: nextDesc,
  });
};

export const syncLssInitiativesUseCase = async (options: {
  boardId: string;
  verbose: boolean;
}) => {
  const now = new Date().toISOString();
  const areas = await loadLssAreas();
  const areaByNoteId = new Map(areas.map((area) => [area.noteId, area]));
  const parsed = await loadLssInitiativesFromJournal({ areas });

  const context = await loadBoardContext({
    boardId: options.boardId,
    allowCreate: false,
    allowCreateLabels: true,
  });
  const triageList = context.listByName.get(listNames.triage);
  if (!triageList) {
    throw new Error("Missing Trello list mapping for Triage");
  }

  const allCards = await fetchBoardCards(options.boardId);
  const plannerCards = derivePlannerCards({
    cards: allCards,
    labelNameById: new Map(context.labels.map((label) => [label.id, label.name])),
    areas,
  });

  const plan = planLssInitiativeActions({
    initiatives: parsed.initiatives,
    cards: plannerCards,
    listById: new Map(context.lists.map((list) => [list.id, list.name])),
  });

  const initiativeByKey = new Map(parsed.initiatives.map((item) => [buildInitiativeKey(item), item]));
  const trelloCardById = new Map(allCards.map((card) => [card.id, card]));
  const journalLabelId = context.labelByName.get(labelNames.journal)?.id ?? null;

  for (const warning of parsed.warnings) {
    console.warn(`[wo:lss] ${warning.message}`);
  }
  for (const warning of plan.warnings) {
    console.warn(`[wo:lss] ${warning}`);
  }

  for (const action of plan.actions) {
    const initiative = initiativeByKey.get(`${action.noteId}:${action.line}`);
    if (!initiative) {
      continue;
    }

    if (action.type === "conflict-skip") {
      await writeEvent({
        ts: now,
        type: "lss.initiative.skipped",
        payload: {
          noteId: initiative.noteId,
          line: initiative.line,
          text: initiative.text,
          reason: action.reason,
        },
      });
      continue;
    }

    if (action.type === "create") {
      const area = areaByNoteId.get(initiative.noteId);
      if (!area) {
        continue;
      }
      const areaLabel = context.labelByName.get(area.label);
      if (!areaLabel) {
        throw new Error(`Missing Trello label mapping for ${area.label}`);
      }
      const syncBlock = buildSyncBlock({
        initiative,
        now,
        cardUrl: null,
      });
      const created = await createCard({
        listId: triageList.id,
        name: initiative.text,
        desc: updateDescriptionWithSync("", syncBlock),
        labelIds: [areaLabel.id, journalLabelId].filter(Boolean) as string[],
      });
      const canonicalUrl = resolveCardUrl(created);
      if (canonicalUrl) {
        await injectTrelloUrlIntoTaskLine({
          filePath: initiative.filePath,
          line: initiative.line,
          trelloUrl: canonicalUrl,
        });
      }
      const refreshed = await updateCardMetadata({
        card: created,
        initiative,
        now,
      });
      trelloCardById.set(refreshed.id, refreshed);
      await writeEvent({
        ts: now,
        type: "lss.initiative.created",
        payload: {
          noteId: initiative.noteId,
          line: initiative.line,
          cardId: refreshed.id,
          cardUrl: resolveCardUrl(refreshed),
        },
      });
      if (options.verbose) {
        console.log(`[wo:lss] create ${initiative.noteId}:${initiative.line} -> ${refreshed.id}`);
      }
      continue;
    }

    if (!action.cardId) {
      continue;
    }
    const card = trelloCardById.get(action.cardId);
    if (!card) {
      continue;
    }

    if (action.type === "link") {
      const url = resolveCardUrl(card) ?? action.trelloUrl;
      if (url) {
        await injectTrelloUrlIntoTaskLine({
          filePath: initiative.filePath,
          line: initiative.line,
          trelloUrl: url,
        });
      }
      const refreshed = await updateCardMetadata({
        card,
        initiative,
        now,
      });
      trelloCardById.set(refreshed.id, refreshed);
      await writeEvent({
        ts: now,
        type: "lss.initiative.linked",
        payload: {
          noteId: initiative.noteId,
          line: initiative.line,
          cardId: refreshed.id,
          cardUrl: resolveCardUrl(refreshed),
        },
      });
      if (options.verbose) {
        console.log(`[wo:lss] link ${initiative.noteId}:${initiative.line} -> ${refreshed.id}`);
      }
      continue;
    }

    if (action.type === "update-title") {
      const updated = await updateCard({
        cardId: card.id,
        name: initiative.text,
      });
      const refreshed = await updateCardMetadata({
        card: updated,
        initiative,
        now,
      });
      trelloCardById.set(refreshed.id, refreshed);
      await writeEvent({
        ts: now,
        type: "lss.initiative.updated_title",
        payload: {
          noteId: initiative.noteId,
          line: initiative.line,
          cardId: refreshed.id,
          cardUrl: resolveCardUrl(refreshed),
        },
      });
      if (options.verbose) {
        console.log(`[wo:lss] update-title ${initiative.noteId}:${initiative.line} -> ${refreshed.id}`);
      }
      continue;
    }

    if (action.type === "check" || action.type === "uncheck") {
      const refreshed = await updateCardMetadata({
        card,
        initiative,
        now,
      });
      trelloCardById.set(refreshed.id, refreshed);
      if (options.verbose) {
        console.log(`[wo:lss] ${action.type} metadata ${initiative.noteId}:${initiative.line} -> ${refreshed.id}`);
      }
    }
  }
};
