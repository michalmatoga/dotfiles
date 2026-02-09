import { loadEnvFile, requireEnv } from "./env";
import { type ReviewRequest } from "./review-requests";
import { trelloRequest, type TrelloCard } from "./trello";

const trelloBoardId = "HZ7hcWZy";
const trelloBlockedListId = "68d38cb24e504757ecc2d19a";
const trelloCodeReviewLabelId = "686cbf33add233ccba380f46";
const trelloWorkLabelId = "6694db7c23e5de7bec1b7489";
const trelloEnvFile = ".env";

const prUrlRegex = /https:\/\/schibsted\.ghe\.com\/[^\s)]+\/pull\/\d+/g;

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels",
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
    console.log(`[dry-run] archive card: ${card.name}`);
    return;
  }
  await trelloRequest(`cards/${card.id}`, { closed: true }, { method: "PUT" });
  console.log(`Archived card: ${card.name}`);
};

export const runReviewRequestSync = async (options: {
  reviewRequests: ReviewRequest[];
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

  for (const card of openCards) {
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
    if (!isActive) {
      await archiveCard(card, options.dryRun);
    }
  }

  return { newlyCreated };
};
