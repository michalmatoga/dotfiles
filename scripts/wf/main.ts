import { join } from "node:path";

import { loadEnvFile } from "./lib/env";
import { fetchAssignedIssues } from "./lib/assigned-issues";
import { fetchReviewRequests } from "./lib/review-requests";
import {
  runReviewSessions,
  runReviewSessionsTargets,
} from "./lib/review-sessions";
import {
  fetchAssignedIssueSessionTargets,
  runAssignedIssueSessions,
} from "./lib/assigned-issue-sessions";
import { runAssignedIssuesSync } from "./lib/workflow-assigned-issues";
import { runReviewRequestSync } from "./lib/workflow-review-requests";
import {
  addSessionComment,
  fetchSessionTargets,
} from "./lib/workflow-review-sessions";

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
  const [reviewRequests, assignedIssues] = await Promise.all([
    fetchReviewRequests({
      host: ghHost,
      user: ghUser,
    }),
    fetchAssignedIssues({
      host: ghHost,
      user: ghUser,
    }),
  ]);

  if (mode === "sessions") {
    const targets = await fetchSessionTargets({ host: ghHost, verbose });
    const issueTargets = await fetchAssignedIssueSessionTargets({ verbose });
    await runReviewSessionsTargets(
      targets,
      {
        host: ghHost,
        workspaceRoot,
        promptPath,
        dryRun,
        verbose,
      },
      async ({ target, sessionId }) => {
        if (!target.cardId) {
          return;
        }
        await addSessionComment({
          cardId: target.cardId,
          sessionId,
          dryRun,
        });
      },
    );
    await runAssignedIssueSessions(issueTargets, {
      host: ghHost,
      workspaceRoot,
      promptPath: "scripts/wf/prompts/issue.md",
      dryRun,
      verbose,
    });
    return;
  }

  await runReviewRequestSync({
    reviewRequests,
    reviewer: ghUser,
    host: ghHost,
    dryRun,
    verbose,
  });

  await runAssignedIssuesSync({
    assignedIssues,
    dryRun,
    verbose,
  });

  if (mode === "trello") {
    return;
  }

  const sessionTargets = await fetchSessionTargets({ host: ghHost, verbose });
  const issueTargets = await fetchAssignedIssueSessionTargets({ verbose });
  await runReviewSessionsTargets(
    sessionTargets,
    {
      host: ghHost,
      workspaceRoot,
      promptPath,
      dryRun,
      verbose,
    },
    async ({ target, sessionId }) => {
      await addSessionComment({
        cardId: target.cardId,
        sessionId,
        dryRun,
      });
    },
  );
  await runAssignedIssueSessions(issueTargets, {
    host: ghHost,
    workspaceRoot,
    promptPath: "scripts/wf/prompts/issue.md",
    dryRun,
    verbose,
  });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
