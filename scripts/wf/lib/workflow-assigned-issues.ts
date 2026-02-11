import { loadEnvFile, requireEnv } from "./env";
import { type AssignedIssue } from "./assigned-issues";
import { trelloRequest, type TrelloCard } from "./trello";

const trelloBoardId = "HZ7hcWZy";
const trelloNewListId = "6694f3249e46f9e9aec6db3b";
const trelloWorkLabelId = "6694db7c23e5de7bec1b7489";
const trelloEnvFile = ".env";
const trelloCodeReviewLabelId = "686cbf33add233ccba380f46";

const issueUrlRegex = /https:\/\/schibsted\.ghe\.com\/[^\s)]+\/issues\/\d+/g;

const fetchOpenCards = async (): Promise<TrelloCard[]> => {
  return trelloRequest<TrelloCard[]>(`boards/${trelloBoardId}/cards`, {
    filter: "open",
    fields: "id,name,desc,idLabels",
  });
};

const extractIssueUrls = (text: string): Set<string> => {
  const matches = text.match(issueUrlRegex) ?? [];
  return new Set(matches);
};

const buildCardDescription = (issue: AssignedIssue) => {
  const body = issue.body?.trim();
  return body ? `Issue: ${issue.url}\n\n${body}` : `Issue: ${issue.url}`;
};

const createTrelloCard = async (issue: AssignedIssue, dryRun: boolean) => {
  const repoPrefix = issue.repo ? `[${issue.repo}] ` : "";
  const name = `ISSUE: ${repoPrefix}${issue.title}`;
  const desc = buildCardDescription(issue);
  if (dryRun) {
    console.log(`[dry-run] create issue card: ${name}`);
    return;
  }
  await trelloRequest(
    "cards",
    {
      idList: trelloNewListId,
      name,
      desc,
      idLabels: trelloWorkLabelId,
    },
    { method: "POST" },
  );
  console.log(`Created issue card: ${name}`);
};

const archiveCard = async (card: TrelloCard, dryRun: boolean) => {
  if (dryRun) {
    console.log(`[dry-run] archive issue card: ${card.name} (${card.id})`);
    return;
  }
  await trelloRequest(`cards/${card.id}`, { closed: true }, { method: "PUT" });
  console.log(`Archived issue card: ${card.name} (${card.id})`);
};

export const runAssignedIssuesSync = async (options: {
  assignedIssues: AssignedIssue[];
  dryRun: boolean;
  verbose: boolean;
}) => {
  await loadEnvFile(trelloEnvFile);
  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const openCards = await fetchOpenCards();
  const openCardUrls = new Set<string>();
  for (const card of openCards) {
    const urls = extractIssueUrls(card.desc);
    for (const url of urls) {
      openCardUrls.add(url);
    }
  }

  if (options.verbose) {
    console.log(`Assigned issues: ${options.assignedIssues.length}`);
    console.log(`Open cards: ${openCards.length}`);
  }

  for (const issue of options.assignedIssues) {
    if (openCardUrls.has(issue.url)) {
      if (options.verbose) {
        console.log(`Skip existing card for ${issue.url}`);
      }
      continue;
    }
    await createTrelloCard(issue, options.dryRun);
  }

  const activeUrls = new Set(options.assignedIssues.map((issue) => issue.url));
  const processedCardIds = new Set<string>();
  for (const card of openCards) {
    if (processedCardIds.has(card.id)) {
      if (options.verbose) {
        console.log(`Skip duplicate card entry: ${card.name} (${card.id})`);
      }
      continue;
    }
    processedCardIds.add(card.id);
    if (!card.idLabels.includes(trelloWorkLabelId)) {
      continue;
    }
    if (card.idLabels.includes(trelloCodeReviewLabelId)) {
      continue;
    }
    const urls = extractIssueUrls(card.desc);
    if (urls.size === 0) {
      continue;
    }
    const isActive = Array.from(urls).some((url) => activeUrls.has(url));
    if (!isActive) {
      await archiveCard(card, options.dryRun);
    }
  }
};
