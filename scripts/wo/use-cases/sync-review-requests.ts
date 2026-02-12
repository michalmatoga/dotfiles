import { requireEnv } from "../lib/env";
import { fetchReviewRequests } from "../lib/gh/reviews";
import { normalizeReviewRequest } from "../lib/normalize";
import { syncInbound } from "../lib/sync/inbound";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";

export const syncReviewRequestsUseCase = async (options: {
  dryRun: boolean;
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const items = await fetchReviewRequests({ host: ghHost, user: ghUser });
  const normalized = items.map(normalizeReviewRequest);
  await syncInbound({
    boardId,
    items: normalized,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
};
