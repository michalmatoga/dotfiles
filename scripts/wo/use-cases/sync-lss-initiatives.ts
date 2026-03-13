import {
  canonicalizeTrelloUrl,
  derivePlannerCards,
  loadLssInitiativesFromJournal,
  planLssInitiativeActions,
  type LssInitiative,
} from "../lib/lss/tasks";
import { planLssCheckboxMirror } from "../lib/lss/checkbox-mirror";
import { injectTrelloUrlIntoTaskLine, setTaskCheckboxStateAtLine } from "../lib/lss/journal-links";
import { listNames, labelNames } from "../lib/policy/mapping";
import { writeEvent } from "../lib/state/events";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
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

const resolveCanonicalCardUrl = (card: { url?: string; shortUrl?: string } | null): string | null =>
  canonicalizeTrelloUrl(resolveCardUrl(card) ?? "");

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
  const listById = new Map(context.lists.map((list) => [list.id, list.name]));

  const checkboxMirrorPlan = planLssCheckboxMirror({
    initiatives: parsed.initiatives,
    managedCards: allCards
      .map((card) => {
        const meta = parseSyncMetadata(card.desc);
        if (meta?.source !== "lss") {
          return null;
        }
        const trelloUrl = canonicalizeTrelloUrl(meta.url ?? "") ?? resolveCanonicalCardUrl(card);
        if (!trelloUrl) {
          return null;
        }
        return {
          cardId: card.id,
          listId: card.idList,
          trelloUrl,
        };
      })
      .filter((entry): entry is { cardId: string; listId: string; trelloUrl: string } => Boolean(entry)),
    listById,
  });

  for (const warning of checkboxMirrorPlan.warnings) {
    console.warn(`[wo:lss] ${warning}`);
  }
  for (const conflict of checkboxMirrorPlan.conflicts) {
    await writeEvent({
      ts: now,
      type: "lss.checkbox.conflict",
      payload: {
        trelloUrl: conflict.trelloUrl,
        reason: conflict.reason,
        cardIds: conflict.cardIds,
        targets: conflict.taskRefs,
      },
    });
  }

  let checkboxUpdates = 0;
  for (const patch of checkboxMirrorPlan.patches) {
    const result = await setTaskCheckboxStateAtLine({
      filePath: patch.filePath,
      line: patch.line,
      checked: patch.checked,
    });
    if (!result.updated) {
      console.warn(
        `[wo:lss] Unable to mirror checkbox for ${patch.noteId}:${patch.line} (${patch.trelloUrl}): ${result.reason}`,
      );
      await writeEvent({
        ts: now,
        type: "lss.checkbox.skipped",
        payload: {
          noteId: patch.noteId,
          line: patch.line,
          trelloUrl: patch.trelloUrl,
          cardId: patch.cardId,
          reason: result.reason ?? "unknown",
        },
      });
      continue;
    }
    checkboxUpdates += 1;
    await writeEvent({
      ts: now,
      type: "lss.checkbox.mirrored",
      payload: {
        noteId: patch.noteId,
        line: patch.line,
        trelloUrl: patch.trelloUrl,
        cardId: patch.cardId,
        checked: patch.checked,
      },
    });
    if (options.verbose) {
      console.log(
        `[wo:lss] checkbox ${patch.checked ? "check" : "uncheck"} ${patch.noteId}:${patch.line} <- ${patch.cardId}`,
      );
    }
  }

  const snapshot = await readLatestSnapshot();
  await writeSnapshot({
    ts: now,
    trello: snapshot?.trello,
    project: snapshot?.project ?? null,
    worktrees: snapshot?.worktrees ?? null,
    lss: {
      lastSyncAt: now,
      byUrl: checkboxMirrorPlan.markersByUrl,
    },
  });

  const parsedForPlanner = checkboxUpdates > 0
    ? await loadLssInitiativesFromJournal({ areas })
    : parsed;

  const plannerCards = derivePlannerCards({
    cards: allCards,
    labelNameById: new Map(context.labels.map((label) => [label.id, label.name])),
    areas,
  });

  const plan = planLssInitiativeActions({
    initiatives: parsedForPlanner.initiatives,
    cards: plannerCards,
    listById,
  });

  const initiativeByKey = new Map(parsedForPlanner.initiatives.map((item) => [buildInitiativeKey(item), item]));
  const trelloCardById = new Map(allCards.map((card) => [card.id, card]));
  const journalLabelId = context.labelByName.get(labelNames.journal)?.id ?? null;

  for (const warning of parsedForPlanner.warnings) {
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

      if (initiative.repoLabelConflict) {
        const reason = `multiple repo-* tags in ${initiative.noteId}: ${initiative.repoLabelCandidates.join(", ")}`;
        console.warn(`[wo:lss] ${reason}`);
        await writeEvent({
          ts: now,
          type: "lss.initiative.skipped",
          payload: {
            noteId: initiative.noteId,
            line: initiative.line,
            text: initiative.text,
            reason,
          },
        });
        continue;
      }

      const areaLabel = context.labelByName.get(area.label);
      if (!areaLabel) {
        throw new Error(`Missing Trello label mapping for ${area.label}`);
      }

      const repoLabel = initiative.repoLabel
        ? context.labelByName.get(initiative.repoLabel)
        : null;
      if (initiative.repoLabel && !repoLabel) {
        const reason = `Missing Trello label mapping for repo tag repo-${initiative.repoLabel}`;
        console.warn(`[wo:lss] ${reason}`);
        await writeEvent({
          ts: now,
          type: "lss.initiative.skipped",
          payload: {
            noteId: initiative.noteId,
            line: initiative.line,
            text: initiative.text,
            reason,
          },
        });
        continue;
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
        labelIds: [areaLabel.id, repoLabel?.id ?? journalLabelId].filter(Boolean) as string[],
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
