import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

type ReviewRequestNode = {
  createdAt?: string;
  requestedReviewer: {
    __typename: "User" | "Team" | string;
    login?: string | null;
    slug?: string | null;
  } | null;
};

type ReviewNode = {
  submittedAt: string | null;
  state: string;
  author: {
    login: string | null;
  } | null;
};

type PullRequestNode = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  repository: {
    nameWithOwner: string;
  };
  timelineItems: {
    totalCount: number;
    nodes: ReviewRequestNode[];
  };
  reviews: {
    totalCount: number;
    nodes: ReviewNode[];
  };
};

type SearchResponse = {
  search: {
    nodes: PullRequestNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

type LatencyResult = {
  repo: string;
  number: number;
  title: string;
  url: string;
  requestAt: string;
  approvalAt: string;
  durationMs: number;
  durationHours: number;
};

type Options = {
  days: number;
  host: string;
  json: boolean;
  debugGh: boolean;
  limit: number | null;
};

const args = process.argv.slice(2);
const options = parseArgs(args);

const searchQueryTemplate =
  "is:pr reviewed-by:%s review:approved updated:>=%s archived:false";
const reviewSearchQuery = `
  query($searchQuery: String!, $cursor: String) {
    search(type: ISSUE, query: $searchQuery, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          updatedAt
          repository { nameWithOwner }
          timelineItems(first: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) {
            totalCount
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  __typename
                  ... on User { login }
                  ... on Team { slug }
                }
              }
            }
          }
          reviews(first: 100) {
            totalCount
            nodes {
              submittedAt
              state
              author { login }
            }
          }
        }
      }
    }
  }
`;

const viewerQuery = `
  query {
    viewer { login }
  }
`;

const journalCsvPath =
  "/home/nixos/ghq/gitlab.com/michalmatoga/journal/pr-review-standard.csv";

(async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const viewerLogin = await fetchViewerLogin();
  const windowStart = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const searchQuery = formatSearchQuery(viewerLogin, windowStartIso);

  const { pullRequests, truncatedReviews, truncatedRequests } =
    await fetchPullRequests(searchQuery);

  const results: LatencyResult[] = [];

  for (const pr of pullRequests) {
    const latency = computeLatency(pr, viewerLogin, windowStart);
    if (latency) results.push(latency);
  }

  appendJournalEntry(
    journalCsvPath,
    buildCsvEntry(
      viewerLogin,
      windowStartIso,
      pullRequests.length,
      results,
      truncatedReviews,
      truncatedRequests,
    ),
  );

  if (options.json) {
    const payload = buildJsonPayload(
      viewerLogin,
      windowStartIso,
      pullRequests.length,
      results,
      truncatedReviews,
      truncatedRequests,
    );
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  renderSummary(
    viewerLogin,
    windowStartIso,
    pullRequests.length,
    results,
    truncatedReviews,
    truncatedRequests,
  );
})();

type CsvEntry = {
  header: string[];
  row: string[];
};

function appendJournalEntry(filePath: string, entry: CsvEntry) {
  const headerLine = `${entry.header.join(",")}\n`;
  const rowLine = `${entry.row.map(escapeCsv).join(",")}\n`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, headerLine, "utf8");
    appendFileSync(filePath, rowLine, "utf8");
    return;
  }

  const existing = safeReadFile(filePath);
  const [firstLine, ...rest] = existing.split("\n");
  const needsRewrite =
    firstLine.trim() !== entry.header.join(",") &&
    firstLine.trim() === "timestamp";

  if (needsRewrite) {
    const preservedRows = rest.filter((line) => line.trim().length > 0);
    const rewritten = [headerLine.trimEnd(), ...preservedRows].join("\n");
    writeFileSync(filePath, `${rewritten}\n`, "utf8");
  }

  appendFileSync(filePath, rowLine, "utf8");
}

function safeReadFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function escapeCsv(value: string): string {
  if (value.includes("\"")) {
    value = value.replace(/\"/g, "\"\"");
  }
  if (/[",\n]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

function buildCsvEntry(
  viewerLogin: string,
  windowStartIso: string,
  scanned: number,
  results: LatencyResult[],
  truncatedReviews: number,
  truncatedRequests: number,
): CsvEntry {
  const durations = results.map((result) => result.durationMs);
  const avg = average(durations);
  const med = median(durations);
  const min = durations.length ? Math.min(...durations) : 0;
  const max = durations.length ? Math.max(...durations) : 0;

  const header = [
    "timestamp",
    "host",
    "viewer",
    "window_start",
    "days",
    "prs_scanned",
    "prs_matched",
    "prs_skipped",
    "average_hours",
    "median_hours",
    "min_hours",
    "max_hours",
    "truncated_reviews",
    "truncated_requests",
  ];

  const row = [
    new Date().toISOString(),
    options.host,
    viewerLogin,
    windowStartIso,
    String(options.days),
    String(scanned),
    String(results.length),
    String(scanned - results.length),
    (avg / (1000 * 60 * 60)).toFixed(4),
    (med / (1000 * 60 * 60)).toFixed(4),
    (min / (1000 * 60 * 60)).toFixed(4),
    (max / (1000 * 60 * 60)).toFixed(4),
    String(truncatedReviews),
    String(truncatedRequests),
  ];

  return { header, row };
}

function parseArgs(argv: string[]): Options {
  let days = 30;
  let host = process.env.GH_HOST ?? "schibsted.ghe.com";
  let json = false;
  let debugGh = false;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--debug-gh") {
      debugGh = true;
      continue;
    }

    if (arg === "--days" || arg.startsWith("--days=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (!value) throw new Error("--days expects a number");
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--days must be a positive number");
      }
      days = parsed;
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--host" || arg.startsWith("--host=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (!value) throw new Error("--host expects a hostname");
      host = value;
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (!value) throw new Error("--limit expects a number");
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive number");
      }
      limit = parsed;
      if (!arg.includes("=")) i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { days, host, json, debugGh, limit };
}

function printHelp() {
  const text = `Usage: npx --yes tsx scripts/pr-review-latency.ts [options]

Options:
  --days <n>     Look back window in days (default: 30)
  --host <host>  GitHub hostname (default: schibsted.ghe.com or GH_HOST)
  --limit <n>    Cap number of PRs fetched (optional)
  --json         Emit JSON output only
  --debug-gh     Print gh commands
  -h, --help     Show this help
`;
  process.stdout.write(text);
}

async function fetchViewerLogin(): Promise<string> {
  const response = await execGhGraphql<{ viewer: { login: string } }>(
    viewerQuery,
    {},
  );
  return response.viewer.login;
}

async function fetchPullRequests(searchQuery: string) {
  let cursor: string | null = null;
  let hasNextPage = true;
  const pullRequests: PullRequestNode[] = [];
  let truncatedReviews = 0;
  let truncatedRequests = 0;

  while (hasNextPage) {
    const response = await execGhGraphql<SearchResponse>(reviewSearchQuery, {
      searchQuery,
      cursor,
    });

    hasNextPage = response.search.pageInfo.hasNextPage;
    cursor = response.search.pageInfo.endCursor;

    for (const pr of response.search.nodes) {
      pullRequests.push(pr);
      if (pr.reviews.totalCount > pr.reviews.nodes.length) {
        truncatedReviews += 1;
      }
      if (pr.timelineItems.totalCount > pr.timelineItems.nodes.length) {
        truncatedRequests += 1;
      }

      if (options.limit && pullRequests.length >= options.limit) {
        return { pullRequests, truncatedReviews, truncatedRequests };
      }
    }

  }

  return { pullRequests, truncatedReviews, truncatedRequests };
}

function formatSearchQuery(viewerLogin: string, dateIso: string): string {
  return searchQueryTemplate
    .replace("%s", viewerLogin)
    .replace("%s", dateIso);
}

function computeLatency(
  pr: PullRequestNode,
  viewerLogin: string,
  windowStart: Date,
): LatencyResult | null {
  const approvals = pr.reviews.nodes
    .filter(
      (review) =>
        review.author?.login === viewerLogin &&
        review.state === "APPROVED" &&
        review.submittedAt,
    )
    .sort((a, b) =>
      (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""),
    );

  if (approvals.length === 0) return null;

  const windowStartMs = windowStart.getTime();
  const requestTimes = pr.timelineItems.nodes
    .filter((request) => request.requestedReviewer?.login === viewerLogin)
    .map((request) => request.createdAt)
    .filter((createdAt): createdAt is string => Boolean(createdAt))
    .filter((createdAt) => new Date(createdAt).getTime() >= windowStartMs)
    .sort();

  if (requestTimes.length === 0) return null;

  for (const approval of approvals) {
    const approvalAt = approval.submittedAt;
    if (!approvalAt) continue;
    const approvalMs = new Date(approvalAt).getTime();

    let candidateRequest: string | null = null;
    for (const requestAt of requestTimes) {
      const requestMs = new Date(requestAt).getTime();
      if (requestMs <= approvalMs) {
        candidateRequest = requestAt;
      }
    }

    if (candidateRequest) {
      const durationMs = approvalMs - new Date(candidateRequest).getTime();
      return {
        repo: pr.repository.nameWithOwner,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        requestAt: candidateRequest,
        approvalAt,
        durationMs,
        durationHours: durationMs / (1000 * 60 * 60),
      };
    }
  }

  return null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[mid - 1] + ordered[mid]) / 2;
  }
  return ordered[mid];
}

function renderSummary(
  viewerLogin: string,
  windowStartIso: string,
  scanned: number,
  results: LatencyResult[],
  truncatedReviews: number,
  truncatedRequests: number,
) {
  const durations = results.map((result) => result.durationMs);
  const avg = average(durations);
  const med = median(durations);
  const min = durations.length ? Math.min(...durations) : 0;
  const max = durations.length ? Math.max(...durations) : 0;
  const skipped = scanned - results.length;

  console.log("Review latency (approval)");
  console.log(
    `- Window: last ${options.days} days (from ${windowStartIso}) — host: ${options.host} — user: ${viewerLogin}`,
  );
  console.log(
    `- PRs scanned: ${scanned} — matched: ${results.length} — skipped: ${skipped}`,
  );
  console.log(
    `- Average: ${formatHours(avg)} (${formatDays(avg)}) — median: ${formatHours(
      med,
    )} — min: ${formatHours(min)} — max: ${formatHours(max)}`,
  );
  console.log(
    "- Note: only direct user review requests are counted (team requests are not attributed).",
  );

  if (truncatedReviews > 0 || truncatedRequests > 0) {
    console.log(
      `- Warning: ${truncatedReviews} PR(s) had >100 reviews; ${truncatedRequests} PR(s) had >100 requests (truncated).`,
    );
  }
}

function buildJsonPayload(
  viewerLogin: string,
  windowStartIso: string,
  scanned: number,
  results: LatencyResult[],
  truncatedReviews: number,
  truncatedRequests: number,
) {
  const durations = results.map((result) => result.durationMs);
  const avg = average(durations);
  const med = median(durations);
  const min = durations.length ? Math.min(...durations) : 0;
  const max = durations.length ? Math.max(...durations) : 0;

  return {
    summary: {
      host: options.host,
      viewer: viewerLogin,
      windowStart: windowStartIso,
      days: options.days,
      scanned,
      matched: results.length,
      skipped: scanned - results.length,
      averageHours: avg / (1000 * 60 * 60),
      medianHours: med / (1000 * 60 * 60),
      minHours: min / (1000 * 60 * 60),
      maxHours: max / (1000 * 60 * 60),
      truncatedReviews,
      truncatedRequests,
      note:
        "Only direct user review requests are counted (team requests are not attributed).",
    },
    items: results,
  };
}

function formatDays(ms: number): string {
  return `${(ms / (1000 * 60 * 60 * 24)).toFixed(2)}d`;
}

function formatHours(ms: number): string {
  return `${(ms / (1000 * 60 * 60)).toFixed(2)}h`;
}

function formatArgs(parts: string[]): string {
  return parts
    .map((part) => (part.includes(" ") ? `"${part}"` : part))
    .join(" ");
}

async function execGhGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
): Promise<T> {
  const args: string[] = ["api", "graphql", "--hostname", options.host];
  args.push("-f", `query=${query}`);

  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    args.push("-f", `${key}=${value}`);
  }

  if (options.debugGh) {
    console.log(`[debug] gh ${formatArgs(args)}`);
  }

  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const details = stderr.toString().trim() || error.message;
          const hint = details.includes("gh auth login")
            ? ""
            : " Try running `gh auth login` if authentication is required.";
          reject(new Error(`gh CLI error: ${details}.${hint}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as { data?: T; errors?: unknown };
          if (!parsed.data) {
            reject(new Error("Missing data in gh response."));
            return;
          }
          resolve(parsed.data);
        } catch (parseError) {
          const message =
            parseError instanceof Error ? parseError.message : String(parseError);
          reject(new Error(`Failed to parse gh output: ${message}`));
        }
      },
    );
  });
}
