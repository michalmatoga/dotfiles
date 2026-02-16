import { loadEnvFile, requireEnv } from "./lib/env";
import { setupBoardUseCase } from "./use-cases/setup-board";
import { syncReviewRequestsUseCase } from "./use-cases/sync-review-requests";
import { syncTrelloToGithubUseCase } from "./use-cases/sync-trello-to-github";
import { syncWorkItemsUseCase } from "./use-cases/sync-work-items";
import { reconcileReviewsUseCase } from "./use-cases/reconcile-reviews";
import { syncWorktreesUseCase } from "./use-cases/sync-worktrees";

type Mode = "all" | "init" | "sync";

const parseArgs = (args: string[]) => {
  const flags = new Set(args);
  const mode: Mode = flags.has("--init-board")
    ? "init"
    : flags.has("--sync-only")
      ? "sync"
      : "all";
  return {
    verbose: flags.has("--verbose"),
    fullRefresh: flags.has("--full-refresh"),
    mode,
  };
};

const main = async () => {
  const { verbose, fullRefresh, mode } = parseArgs(process.argv.slice(2));
  await loadEnvFile(".env");

  if (mode === "init") {
    await setupBoardUseCase({
      boardName: "LSS",
      existingBoardShortLink: "HZ7hcWZy",
      verbose,
    });
    return;
  }

  requireEnv("TRELLO_BOARD_ID_WO");

  await syncWorkItemsUseCase({ verbose, fullRefresh });
  await syncReviewRequestsUseCase({ verbose });
  await syncTrelloToGithubUseCase({ verbose });
  await reconcileReviewsUseCase({ verbose });
  await syncWorktreesUseCase({ verbose });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
