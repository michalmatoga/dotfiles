import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listAliases, listNames } from "../policy/mapping";
import { parseSyncMetadata } from "./metadata";
import { fetchPrDetails } from "../gh/pr-details";
import { writeEvent } from "../state/events";

const extractPrUrl = (desc: string): string | null => {
  const match = desc.match(/https:\/\/[^\s]+\/pull\/\d+/);
  return match?.[0] ?? null;
};

export const reconcileReviewLifecycle = async (options: {
  boardId: string;
  host: string;
  user: string;
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
    const metaUrl = meta?.url ?? null;
    const url = metaUrl && metaUrl.includes("/pull/") ? metaUrl : extractPrUrl(card.desc);
    if (!url) {
      continue;
    }
    const details = await fetchPrDetails({ host: options.host, url });
    const reviewedByUser = details.reviews.some((review) => review.author === options.user);
    const approvedByUser = details.reviews.some(
      (review) => review.author === options.user && review.state === "APPROVED",
    );
    const closed = details.merged || details.state === "CLOSED" || details.state === "MERGED";

    if (closed && !reviewedByUser && card.idList !== doneList.id) {
      if (options.verbose) {
        console.log(`Archiving review card ${card.id} (merged/closed without review).`);
      }
      await updateCard({ cardId: card.id, closed: true });
      await writeEvent({
        ts: new Date().toISOString(),
        type: "trello.review.archived.merged",
        payload: { cardId: card.id, url },
      });
      continue;
    }

    if (!approvedByUser) {
      continue;
    }
    if (card.idList === doneList.id) {
      continue;
    }
    const fromList = context.lists.find((list) => list.id === card.idList) ?? null;
    const fromListName = fromList ? listAliases[fromList.name] ?? fromList.name : null;
    const toListName = listAliases[doneList.name] ?? doneList.name;
    if (options.verbose) {
      console.log(`Moving review card ${card.id} to Done (approved).`);
    }
    await updateCard({ cardId: card.id, listId: doneList.id, pos: "top" });
    await writeEvent({
      ts: new Date().toISOString(),
      type: "trello.review.done",
      payload: { cardId: card.id, url },
    });
    await writeEvent({
      ts: new Date().toISOString(),
      type: "trello.card.moved",
      payload: {
        cardId: card.id,
        url,
        itemId: meta?.itemId ?? null,
        fromList: fromListName,
        toList: toListName,
        labels: card.idLabels,
        name: card.name,
      },
    });
  }
};
