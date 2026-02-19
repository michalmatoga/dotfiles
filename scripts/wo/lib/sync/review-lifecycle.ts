import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listAliases, listNames } from "../policy/mapping";
import { extractDescriptionBase, formatSyncMetadata, parseSyncMetadata, updateDescriptionWithSync } from "./metadata";
import { fetchPrDetails } from "../gh/pr-details";
import { writeEvent } from "../state/events";
import { createHash } from "node:crypto";

const contentHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const extractPrUrl = (desc: string): string | null => {
  const match = desc.match(/https:\/\/[^\s]+\/pull\/\d+/);
  return match?.[0] ?? null;
};

const findLatestReviewByUser = (
  reviews: Array<{ author: string; state: string; submittedAt: string | null }>,
  user: string,
): { author: string; state: string; submittedAt: string | null } | null => {
  const userReviews = reviews.filter((r) => r.author === user);
  if (userReviews.length === 0) return null;
  return userReviews.sort((a, b) => {
    const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return bTime - aTime;
  })[0];
};

const isReRequestedByAuthor = (
  details: {
    reviewRequests: string[];
    reviews: Array<{ author: string; state: string; submittedAt: string | null }>;
  },
  user: string,
): boolean => {
  // Check if user is currently requested to review
  if (!details.reviewRequests.includes(user)) return false;

  // Check if user has already submitted a review (re-request scenario)
  const userReviews = details.reviews.filter((r) => r.author === user);
  return userReviews.length > 0;
};

type ReviewState = "PENDING" | "CHANGES_REQUESTED" | "APPROVED" | "RE_REQUESTED";

const determineTargetState = (options: {
  details: {
    reviewRequests: string[];
    reviews: Array<{ author: string; state: string; submittedAt: string | null }>;
    merged: boolean;
    state: string | null;
  };
  user: string;
  lastReviewState: ReviewState | null;
}): { state: ReviewState | null; reason: string } => {
  const { details, user, lastReviewState } = options;

  // Check for approval first (highest priority)
  const approvedByUser = details.reviews.some(
    (review) => review.author === user && review.state === "APPROVED",
  );
  if (approvedByUser) {
    return { state: "APPROVED", reason: "approved" };
  }

  // Check for re-request (author re-requested review after changes)
  if (isReRequestedByAuthor(details, user)) {
    return { state: "RE_REQUESTED", reason: "re-requested" };
  }

  // Check if user requested changes
  const latestUserReview = findLatestReviewByUser(details.reviews, user);
  if (latestUserReview?.state === "CHANGES_REQUESTED") {
    return { state: "CHANGES_REQUESTED", reason: "changes-requested" };
  }

  // No action needed - keep current state
  return { state: null, reason: "no-change" };
};

const getTargetListForState = (
  state: ReviewState,
  context: {
    listByName: Map<string, { id: string; name: string }>;
  },
): { id: string; name: string } | null => {
  switch (state) {
    case "APPROVED":
      return context.listByName.get(listNames.done) ?? null;
    case "CHANGES_REQUESTED":
      return context.listByName.get(listNames.waiting) ?? null;
    case "RE_REQUESTED":
      return context.listByName.get(listNames.ready) ?? null;
    case "PENDING":
      return context.listByName.get(listNames.ready) ?? null;
    default:
      return null;
  }
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

  if (!reviewLabelId) {
    throw new Error("Missing review label in Trello board");
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
    const closed = details.merged || details.state === "CLOSED" || details.state === "MERGED";

    // Handle merged/closed without review
    if (closed && !reviewedByUser) {
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

    // Determine target state based on review activity
    const lastState = (meta?.status as ReviewState | null) ?? null;
    const { state: targetState, reason } = determineTargetState({
      details,
      user: options.user,
      lastReviewState: lastState,
    });

    if (!targetState) {
      continue;
    }

    // Get target list
    const targetList = getTargetListForState(targetState, context);
    if (!targetList) {
      continue;
    }

    // Skip if already in target list
    if (card.idList === targetList.id) {
      continue;
    }

    // Build updated metadata
    const base = extractDescriptionBase(card.desc);
    const syncBlock = formatSyncMetadata({
      source: meta?.source ?? "ghe-project",
      itemId: meta?.itemId ?? null,
      url: meta?.url ?? url,
      status: targetState,
      lastSeen: new Date().toISOString(),
      contentHash: contentHash(base),
      lastTrelloMove: meta?.lastTrelloMove ?? null,
    });
    const desc = updateDescriptionWithSync(base, syncBlock);

    const fromList = context.lists.find((list) => list.id === card.idList) ?? null;
    const fromListName = fromList ? listAliases[fromList.name] ?? fromList.name : null;
    const toListName = listAliases[targetList.name] ?? targetList.name;

    if (options.verbose) {
      console.log(`Moving review card ${card.id} to ${toListName} (${reason}).`);
    }

    await updateCard({
      cardId: card.id,
      listId: targetList.id,
      desc,
      pos: targetState === "RE_REQUESTED" ? "top" : undefined,
    });

    // Write appropriate event
    const eventType =
      targetState === "APPROVED"
        ? "trello.review.done"
        : targetState === "CHANGES_REQUESTED"
          ? "trello.review.changes-requested"
          : "trello.review.re-requested";

    await writeEvent({
      ts: new Date().toISOString(),
      type: eventType,
      payload: { cardId: card.id, url, fromList: fromListName, toList: toListName },
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
