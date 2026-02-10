import { loadEnvFile, requireEnv } from "./env";
import { fetchReviewRequestByUrl, type ReviewRequest } from "./review-requests";
import { trelloRequest, type TrelloCard, type TrelloComment } from "./trello";
import { extractPrUrls } from "./workflow-review-requests";

export type ReviewSessionTarget = {
  request: ReviewRequest;
  cardId: string;
};

const trelloBoardId = "HZ7hcWZy";
const trelloCodeReviewLabelId = "686cbf33add233ccba380f46";
const trelloEnvFile = ".env";
const sessionMarkerRegex = /\bopencode\s+-s\s+\S+/i;

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels",
  });
};

const fetchCardComments = async (cardId: string): Promise<TrelloComment[]> => {
  return trelloRequest<TrelloComment[]>(`cards/${cardId}/actions`, {
    filter: "commentCard",
    fields: "data",
  });
};

const hasSessionComment = async (cardId: string): Promise<boolean> => {
  const comments = await fetchCardComments(cardId);
  return comments.some((comment) => sessionMarkerRegex.test(comment.data.text));
};

export const addSessionComment = async (options: {
  cardId: string;
  sessionId: string;
  dryRun: boolean;
}) => {
  const comment = `opencode -s ${options.sessionId}`;
  if (options.dryRun) {
    console.log(`[dry-run] add session comment: ${comment}`);
    return;
  }
  await trelloRequest(
    `cards/${options.cardId}/actions/comments`,
    { text: comment },
    { method: "POST" },
  );
  console.log(`Added session comment: ${comment}`);
};

export const fetchSessionTargets = async (options: {
  host: string;
  verbose: boolean;
}): Promise<ReviewSessionTarget[]> => {
  await loadEnvFile(trelloEnvFile);
  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const openCards = await fetchOpenCards();
  const targets: ReviewSessionTarget[] = [];

  for (const card of openCards) {
    if (!card.idLabels.includes(trelloCodeReviewLabelId)) {
      continue;
    }

    const urls = extractPrUrls(card.desc);
    const [url] = urls;
    if (!url) {
      if (options.verbose) {
        console.log(`Skip Code Review card without PR URL: ${card.name}`);
      }
      continue;
    }

    const alreadyHasSession = await hasSessionComment(card.id);
    if (alreadyHasSession) {
      if (options.verbose) {
        console.log(`Skip card with session comment: ${card.name}`);
      }
      continue;
    }

    const request = await fetchReviewRequestByUrl({ host: options.host, url });
    targets.push({ request, cardId: card.id });
  }

  return targets;
};
