import { join } from "node:path";

import { loadEnvFile } from "./lib/env";
import { fetchReviewRequests } from "./lib/review-requests";
import { runReviewSessions } from "./lib/review-sessions";
import { runReviewRequestSync } from "./lib/workflow-review-requests";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";
const promptPath = "scripts/wf/prompts/review.md";
const workspaceRoot = join(process.env.HOME ?? "", "g", ghHost);

const parseArgs = (args: string[]) => {
  const flags = new Set(args);
  const mode = flags.has("--sessions")
    ? "sessions"
    : flags.has("--trello")
      ? "trello"
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
  const reviewRequests = await fetchReviewRequests({
    host: ghHost,
    user: ghUser,
  });

  if (mode === "sessions") {
    await runReviewSessions(reviewRequests, {
      host: ghHost,
      workspaceRoot,
      promptPath,
      dryRun,
      verbose,
    });
    return;
  }

  const { newlyCreated } = await runReviewRequestSync({
    reviewRequests,
    dryRun,
    verbose,
  });

  if (mode === "trello") {
    return;
  }

  await runReviewSessions(newlyCreated, {
    host: ghHost,
    workspaceRoot,
    promptPath,
    dryRun,
    verbose,
  });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
