import { requireEnv } from "../lib/env";
import { fetchReviewRequests } from "../lib/gh/reviews";
import { normalizeReviewRequest } from "../lib/normalize";
import { syncInbound } from "../lib/sync/inbound";
import { syncLinkedPrs } from "../lib/sync/linked-prs";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";

export const syncReviewRequestsUseCase = async (options: {
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const items = await fetchReviewRequests({ host: ghHost, user: ghUser });
  const normalized = items.map(normalizeReviewRequest);
  const handledPrs = await syncLinkedPrs({
    boardId,
    host: ghHost,
    currentUser: ghUser,
    prUrls: normalized.map((item) => item.url),
    verbose: options.verbose,
  });
  const remaining = normalized.filter((item) => !handledPrs.has(item.url));
  if (remaining.length > 0) {
    await syncInbound({
      boardId,
      items: remaining,
      verbose: options.verbose,
    });
  }
};
