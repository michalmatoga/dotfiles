import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

type ReviewRequest = {
  title: string;
  url: string;
  body: string | null;
  repo: string | null;
};

type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idLabels: string[];
};

const execFileAsync = promisify(execFile);

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";
const trelloBoardId = "HZ7hcWZy";
const trelloBlockedListId = "68d38cb24e504757ecc2d19a";
const trelloCodeReviewLabelId = "686cbf33add233ccba380f46";
const trelloWorkLabelId = "6694db7c23e5de7bec1b7489";
const trelloEnvFile = ".env";

const prUrlRegex = new RegExp(
  `https://${ghHost.replace(/\./g, "\\.")}/[^\s)]+/pull/\\d+`,
  "g",
);

const readEnvFile = async (filePath: string) => {
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, valueRaw] = match;
    const value = valueRaw.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const parseArgs = (args: string[]) => {
  const flags = new Set(args);
  return {
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
};

const ghJson = async <T,>(args: string[]): Promise<T> => {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      env: { ...process.env, GH_HOST: ghHost },
      maxBuffer: 1024 * 1024 * 10,
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to query GitHub via gh CLI (${ghHost}). ${message}. Ensure gh auth is set up for ${ghHost}.`,
    );
  }
};

const trelloRequest = async <T,>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options: { method?: string } = {},
): Promise<T> => {
  const apiKey = requireEnv("TRELLO_API_KEY");
  const token = requireEnv("TRELLO_TOKEN");
  const url = new URL(`https://api.trello.com/1/${path}`);

  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { method: options.method ?? "GET" });
  if (!response.ok) {
    throw new Error(
      `Trello API request failed (${response.status} ${response.statusText}) for ${path}`,
    );
  }
  return (await response.json()) as T;
};

const fetchReviewRequests = async (): Promise<ReviewRequest[]> => {
  const response = await ghJson<Array<{ title: string; url: string; body: string | null }>>([
    "search",
    "prs",
    "draft:false",
    "--review-requested",
    ghUser,
    "--state",
    "open",
    "--json",
    "title,url,body",
    "--limit",
    "100",
  ]);

  return response.map((item) => ({
    title: item.title,
    url: item.url,
    body: item.body ?? null,
    repo: extractRepoSlug(item.url),
  }));
};

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

const extractRepoSlug = (url: string): string | null => {
  const match = url.match(new RegExp(`https://${ghHost.replace(/\./g, "\\.")}/([^/]+/[^/]+)/pull/\\d+`));
  return match?.[1] ?? null;
};

const createTrelloCard = async (
  listId: string,
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
    idList: listId,
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

const main = async () => {
  const { dryRun, verbose } = parseArgs(process.argv.slice(2));
  await readEnvFile(trelloEnvFile);

  requireEnv("TRELLO_API_KEY");
  requireEnv("TRELLO_TOKEN");

  const [openCards, reviewRequests] = await Promise.all([
    fetchOpenCards(),
    fetchReviewRequests(),
  ]);

  const openCardUrls = new Set<string>();
  for (const card of openCards) {
    const urls = extractPrUrls(card.desc);
    for (const url of urls) {
      openCardUrls.add(url);
    }
  }

  const activeUrls = new Set(reviewRequests.map((request) => request.url));

  if (verbose) {
    console.log(`Review requests: ${reviewRequests.length}`);
    console.log(`Open cards: ${openCards.length}`);
  }

  for (const request of reviewRequests) {
    if (openCardUrls.has(request.url)) {
      if (verbose) {
        console.log(`Skip existing card for ${request.url}`);
      }
      continue;
    }
    await createTrelloCard(trelloBlockedListId, request, dryRun);
  }

  for (const card of openCards) {
    if (!card.idLabels.includes(trelloCodeReviewLabelId)) {
      continue;
    }
    const urls = extractPrUrls(card.desc);
    if (urls.size === 0) {
      if (verbose) {
        console.log(`Skip unlabeled card without PR URL: ${card.name}`);
      }
      continue;
    }
    const isActive = Array.from(urls).some((url) => activeUrls.has(url));
    if (!isActive) {
      await archiveCard(card, dryRun);
    }
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
