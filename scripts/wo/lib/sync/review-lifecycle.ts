import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listNames } from "../policy/mapping";
import { parseSyncMetadata } from "./metadata";
import { hasApprovedReview } from "../gh/reviews";
import { writeEvent } from "../state/events";

export const reconcileReviewLifecycle = async (options: {
  boardId: string;
  host: string;
  user: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false });
  const cards = await fetchBoardCards(options.boardId);
  const reviewLabelId = context.labelByName.get(labelNames.review)?.id;
  const doneList = context.listByName.get(listNames.done);

  if (!reviewLabelId || !doneList) {
    throw new Error("Missing review label or Done list in Trello board");
  }

  for (const card of cards) {
    if (!card.idLabels.includes(reviewLabelId)) {
      continue;
    }
    const meta = parseSyncMetadata(card.desc);
    const url = meta?.url;
    if (!url) {
      continue;
    }
    const approved = await hasApprovedReview({ host: options.host, url, user: options.user });
    if (!approved) {
      continue;
    }
    if (card.idList === doneList.id) {
      continue;
    }
    if (options.verbose) {
      console.log(`Moving review card ${card.id} to Done (approved).`);
    }
    if (!options.dryRun) {
      await updateCard({ cardId: card.id, listId: doneList.id });
    }
    await writeEvent({
      ts: new Date().toISOString(),
      type: "trello.review.done",
      payload: { cardId: card.id, url },
    });
  }
};
