import { loadEnvFile, requireEnv } from "./env";
import { ghJson } from "./gh";
import { type ReviewRequest } from "./review-requests";
import { trelloRequest, type TrelloCard } from "./trello";

const trelloBoardId = "HZ7hcWZy";
const trelloBlockedListId = "68d38cb24e504757ecc2d19a";
const trelloDoneListName = "Done";
const trelloCodeReviewLabelId = "686cbf33add233ccba380f46";
const trelloWorkLabelId = "6694db7c23e5de7bec1b7489";
const trelloEnvFile = ".env";

const prUrlRegex = /https:\/\/schibsted\.ghe\.com\/[^\s)]+\/pull\/\d+/g;

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels,idList",
  });
};

const extractPrUrls = (text: string): Set<string> => {
  const matches = text.match(prUrlRegex) ?? [];
  return new Set(matches);
};

const buildCardDescription = (request: ReviewRequest) => {
  const body = request.body?.trim();
  return body ? `PR: ${request.url}\n\n${body}` : `PR: ${request.url}`;
};

const createTrelloCard = async (
  request: ReviewRequest,
  dryRun: boolean,
) => {
  const repoPrefix = request.repo ? `[${request.repo}] ` : "";
  const name = `REVIEW: ${repoPrefix}${request.title}`;
  const desc = buildCardDescription(request);
  if (dryRun) {
    console.log(`[dry-run] create card: ${name}`);
    return;
  }
  await trelloRequest(
    "cards",
    {
      idList: trelloBlockedListId,
      name,
      desc,
      idLabels: `${trelloCodeReviewLabelId},${trelloWorkLabelId}`,
    },
    { method: "POST" },
  );
  console.log(`Created card: ${name}`);
};

const archiveCard = async (card: TrelloCard, dryRun: boolean) => {
  if (dryRun) {
    console.log(`[dry-run] archive card: ${card.name} (${card.id})`);
    return;
  }
  await trelloRequest(`cards/${card.id}`, { closed: true }, { method: "PUT" });
  console.log(`Archived card: ${card.name} (${card.id})`);
};

const moveCardToDone = async (card: TrelloCard, dryRun: boolean) => {
  const doneListId = await fetchDoneListId();
  if (dryRun) {
    console.log(`[dry-run] move card to Done: ${card.name} (${card.id})`);
    return;
  }
  await trelloRequest(
    `cards/${card.id}`,
    { idList: doneListId },
    { method: "PUT" },
  );
  console.log(`Moved card to Done: ${card.name} (${card.id})`);
};

const moveCardToBlocked = async (card: TrelloCard, dryRun: boolean) => {
  if (dryRun) {
    console.log(`[dry-run] move card to Blocked: ${card.name} (${card.id})`);
    return;
  }
  await trelloRequest(
    `cards/${card.id}`,
    { idList: trelloBlockedListId },
    { method: "PUT" },
  );
  console.log(`Moved card to Blocked: ${card.name} (${card.id})`);
};

type ReviewDecision = "approved" | "missed" | "rejected" | "unknown";

const parsePrReference = (url: string) => {
  const match = url.match(
    /^https:\/\/schibsted\.ghe\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
};

const fetchReviewDecision = async (options: {
  url: string;
  user: string;
  host: string;
}): Promise<ReviewDecision> => {
  const ref = parsePrReference(options.url);
  if (!ref) {
    return "unknown";
  }
  const pr = await ghJson<{
    mergedAt: string | null;
    reviews: Array<{ author?: { login?: string }; state?: string }>;
  }>(
    [
      "pr",
      "view",
      options.url,
      "--json",
      "mergedAt,reviews",
    ],
    { host: options.host },
  );

  const userReviews = pr.reviews
    .filter((review) => review.author?.login === options.user)
    .map((review) => review.state ?? "");

  if (userReviews.includes("CHANGES_REQUESTED")) {
    return "rejected";
  }

  if (userReviews.includes("APPROVED")) {
    return "approved";
  }

  return pr.mergedAt ? "missed" : "unknown";
};

let doneListIdCache: string | null = null;
const fetchDoneListId = async () => {
  if (doneListIdCache) {
    return doneListIdCache;
  }
  const lists = await trelloRequest<Array<{ id: string; name: string }>>(
    `boards/${trelloBoardId}/lists`,
    { fields: "name" },
  );
  const match = lists.find((list) => list.name === trelloDoneListName);
  if (!match) {
    throw new Error(`Trello list "${trelloDoneListName}" not found.`);
  }
  doneListIdCache = match.id;
  return match.id;
};

const isCardInDone = async (card: TrelloCard) => {
  if (!card.idList) {
    return false;
  }
  const doneListId = await fetchDoneListId();
  return card.idList === doneListId;
};

const isCardInBlocked = (card: TrelloCard) => {
  if (!card.idList) {
    return false;
  }
  return card.idList === trelloBlockedListId;
};

export const runReviewRequestSync = async (options: {
  reviewRequests: ReviewRequest[];
  reviewer: string;
  host: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  await loadEnvFile(trelloEnvFile);
  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const openCards = await fetchOpenCards();

  const openCardUrls = new Set<string>();
  for (const card of openCards) {
    const urls = extractPrUrls(card.desc);
    for (const url of urls) {
      openCardUrls.add(url);
    }
  }

  if (options.verbose) {
    console.log(`Review requests: ${options.reviewRequests.length}`);
    console.log(`Open cards: ${openCards.length}`);
  }

  const newlyCreated: ReviewRequest[] = [];
  for (const request of options.reviewRequests) {
    if (openCardUrls.has(request.url)) {
      if (options.verbose) {
        console.log(`Skip existing card for ${request.url}`);
      }
      continue;
    }
    await createTrelloCard(request, options.dryRun);
    newlyCreated.push(request);
  }

  const activeUrls = new Set(options.reviewRequests.map((request) => request.url));

  const processedCardIds = new Set<string>();
  for (const card of openCards) {
    if (processedCardIds.has(card.id)) {
      if (options.verbose) {
        console.log(`Skip duplicate card entry: ${card.name} (${card.id})`);
      }
      continue;
    }
    processedCardIds.add(card.id);
    if (!card.idLabels.includes(trelloCodeReviewLabelId)) {
      continue;
    }
    const urls = extractPrUrls(card.desc);
    if (urls.size === 0) {
      if (options.verbose) {
        console.log(`Skip unlabeled card without PR URL: ${card.name}`);
      }
      continue;
    }
    const isActive = Array.from(urls).some((url) => activeUrls.has(url));
    if (isActive) {
      continue;
    }

    const [url] = urls;
    if (!url) {
      continue;
    }

    try {
      const decision = await fetchReviewDecision({
        url,
        user: options.reviewer,
        host: options.host,
      });
      if (decision === "approved") {
        if (await isCardInDone(card)) {
          if (options.verbose) {
            console.log(`Skip Done card: ${card.name} (${card.id})`);
          }
          continue;
        }
        await moveCardToDone(card, options.dryRun);
      } else if (decision === "rejected") {
        if (isCardInBlocked(card)) {
          if (options.verbose) {
            console.log(`Skip Blocked card after rejection: ${card.name}`);
          }
          continue;
        }
        await moveCardToBlocked(card, options.dryRun);
      } else if (decision === "missed") {
        await archiveCard(card, options.dryRun);
      } else if (options.verbose) {
        console.log(`Keep card for unresolved PR: ${card.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to evaluate PR for ${card.name}: ${message}`);
    }
  }

  return { newlyCreated };
};
