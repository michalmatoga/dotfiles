import { loadEnvFile, requireEnv } from "./lib/env";
import { setupBoardUseCase } from "./use-cases/setup-board";
import { syncReviewRequestsUseCase } from "./use-cases/sync-review-requests";
import { syncTrelloToGithubUseCase } from "./use-cases/sync-trello-to-github";
import { syncWorkItemsUseCase } from "./use-cases/sync-work-items";
import { reconcileReviewsUseCase } from "./use-cases/reconcile-reviews";

type Mode = "all" | "init" | "sync";

const parseArgs = (args: string[]) => {
  const flags = new Set(args);
  const mode: Mode = flags.has("--init-board")
    ? "init"
    : flags.has("--sync-only")
      ? "sync"
      : "all";
  return {
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
    mode,
  };
};

const main = async () => {
  const { dryRun, verbose, mode } = parseArgs(process.argv.slice(2));
  await loadEnvFile(".env");

  if (mode === "init") {
    await setupBoardUseCase({
      boardName: "LSS",
      existingBoardShortLink: "HZ7hcWZy",
      dryRun,
      verbose,
    });
    return;
  }

  requireEnv("TRELLO_BOARD_ID_WO");

  await syncWorkItemsUseCase({ dryRun, verbose });
  await syncReviewRequestsUseCase({ dryRun, verbose });
  await syncTrelloToGithubUseCase({ dryRun, verbose });
  await reconcileReviewsUseCase({ dryRun, verbose });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
