import { requireEnv } from "../lib/env";
import {
  DEFAULT_JOURNAL_PATH,
  derivePlannerCards,
  loadLssInitiativesFromJournal,
  planLssJournalBackfillActions,
  planLssInitiativeActions,
  type LssPlannedAction,
} from "../lib/lss/tasks";
import { fetchBoardCards } from "../lib/trello/cards";
import { loadLssAreas } from "../lib/trello/lss-areas";
import { fetchBoardLabels } from "../lib/trello/labels";
import { fetchBoardLists } from "../lib/trello/lists";

const actionLabel: Record<LssPlannedAction["type"], string> = {
  create: "create",
  link: "link",
  "update-title": "update-title",
  check: "check",
  uncheck: "uncheck",
  "conflict-skip": "conflict-skip",
};

export const previewLssDryRunUseCase = async (options: {
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const journalPath = process.env.WO_JOURNAL_PATH ?? DEFAULT_JOURNAL_PATH;
  const areas = await loadLssAreas();
  const areaByNoteId = new Map(areas.map((area) => [area.noteId, area]));

  const parsed = await loadLssInitiativesFromJournal({
    areas,
    journalPath,
  });

  const [cards, lists, labels] = await Promise.all([
    fetchBoardCards(boardId),
    fetchBoardLists(boardId),
    fetchBoardLabels(boardId),
  ]);

  const listById = new Map(lists.map((list) => [list.id, list.name]));
  const labelNameById = new Map(labels.map((label) => [label.id, label.name]));
  const plannerCards = derivePlannerCards({
    cards,
    labelNameById,
    areas,
  });

  const plan = planLssInitiativeActions({
    initiatives: parsed.initiatives,
    cards: plannerCards,
    listById,
  });
  const backfillPlan = planLssJournalBackfillActions({
    initiatives: parsed.initiatives,
    cards,
    labelNameById,
    areas,
    journalPath,
  });

  const noteOrder = areas.map((area) => area.noteId);
  const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
  const actionsByNote = new Map<string, LssPlannedAction[]>();
  for (const action of plan.actions) {
    const existing = actionsByNote.get(action.noteId) ?? [];
    existing.push(action);
    actionsByNote.set(action.noteId, existing);
  }

  const backfillByNote = new Map<string, Array<{ line: string; text: string; cardId: string; url: string; reason: string }>>();
  for (const action of backfillPlan.actions) {
    const existing = backfillByNote.get(action.noteId) ?? [];
    existing.push({
      line: "?",
      text: action.text,
      cardId: action.cardId,
      url: action.trelloUrl,
      reason: action.reason,
    });
    backfillByNote.set(action.noteId, existing);
  }

  console.log("[wo:lss] Dry-run preview (no writes)");
  console.log(`[wo:lss] Journal root: ${journalPath}`);
  console.log(`[wo:lss] Parsed initiatives: ${parsed.initiatives.length}`);
  console.log(`[wo:lss] Planned actions: ${plan.actions.length + backfillPlan.actions.length}`);

  const sortedNotes = [...new Set([...actionsByNote.keys(), ...backfillByNote.keys()])].sort((a, b) => {
    return (noteRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (noteRank.get(b) ?? Number.MAX_SAFE_INTEGER)
      || a.localeCompare(b);
  });

  for (const noteId of sortedNotes) {
    const area = areaByNoteId.get(noteId);
    const header = area ? `${area.title} (${noteId})` : noteId;
    console.log(`\n[wo:lss] ${header}`);
    const actions = actionsByNote.get(noteId) ?? [];
    const backfills = backfillByNote.get(noteId) ?? [];
    for (const action of backfills) {
      console.log(
        `  - backfill-journal:${action.line} ${action.text} card=${action.cardId} url=${action.url} (${action.reason})`,
      );
    }
    for (const action of actions) {
      const card = action.cardId ? ` card=${action.cardId}` : "";
      const link = action.trelloUrl ? ` url=${action.trelloUrl}` : "";
      console.log(
        `  - ${actionLabel[action.type]}:${action.line} ${action.text}${card}${link} (${action.reason})`,
      );
    }
  }

  const warnings = [...parsed.warnings.map((warning) => warning.message), ...backfillPlan.warnings, ...plan.warnings];
  if (warnings.length > 0) {
    console.log("\n[wo:lss] Warnings");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (options.verbose && plan.actions.length === 0 && backfillPlan.actions.length === 0) {
    console.log("[wo:lss] No actions required");
  }
};
