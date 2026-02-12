import { requireEnv } from "../lib/env";
import { reconcileReviewLifecycle } from "../lib/sync/review-lifecycle";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";

export const reconcileReviewsUseCase = async (options: {
  dryRun: boolean;
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  await reconcileReviewLifecycle({
    boardId,
    host: ghHost,
    user: ghUser,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
};
