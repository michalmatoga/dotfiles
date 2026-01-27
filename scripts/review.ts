import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

type RepositoryInfo = {
  name: string;
  nameWithOwner?: string | null;
  owner?: {
    login: string;
  } | null;
};

type PullRequest = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  repository: RepositoryInfo | null;
  author: {
    login: string | null;
  } | null;
};

const intervalMs = 5 * 60 * 1000;
const ghHost = process.env.GH_HOST ?? "github.com";
const ghUser = process.env.GH_USER ?? "@me";
const seen = new Set<string>();
const ansiPattern = /\u001B\[[0-9;]*[A-Za-z]/g;
const args = process.argv.slice(2);
const mockAuthored = args.includes("--mock-authored");
const debugGh =
  args.includes("--debug-gh") || process.env.REVIEW_DEBUG_GH === "1";

function runGhSearch(): Promise<string> {
  return execGhQuery([
    "search",
    "prs",
    "--review-requested",
    ghUser,
    "--state",
    "open",
  ]);
}

function runGhSearchAuthored(): Promise<string> {
  return execGhQuery([
    "search",
    "prs",
    "--author",
    ghUser,
    "--state",
    "open",
    "--sort",
    "created",
    "--order",
    "desc",
  ]);
}

function execGhQuery(baseArgs: string[]): Promise<string> {
  const finalArgs = [
    ...baseArgs,
    "--json",
    ["number", "title", "url", "updatedAt", "repository", "author"].join(","),
    "--limit",
    "50",
  ];

  if (debugGh) {
    console.log(`[debug] gh ${formatArgs(finalArgs)}`);
  }

  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      finalArgs,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const details = stderr.toString().trim() || error.message;
          const hint = details.includes("gh auth login")
            ? ""
            : " Try running `gh auth login` if authentication is required.";
          reject(new Error(`gh CLI error: ${details}.${hint}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function formatArgs(parts: string[]): string {
  return parts
    .map((part) => (part.includes(" ") ? `"${part}"` : part))
    .join(" ");
}

function repoName(repo: RepositoryInfo | null): string {
  if (!repo) return "unknown";
  if (repo.nameWithOwner && repo.nameWithOwner.length > 0) {
    return repo.nameWithOwner;
  }
  if (repo.owner?.login) {
    return `${repo.owner.login}/${repo.name}`;
  }
  return repo.name;
}

async function fetchPullRequests(): Promise<PullRequest[]> {
  const raw = await (mockAuthored ? runGhSearchAuthored() : runGhSearch());

  try {
    const parsed = JSON.parse(raw) as PullRequest[];
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse gh output: ${message}`);
  }
}

function timeAgo(dateIso: string): string {
  const deltaMs = Date.now() - new Date(dateIso).getTime();

  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  for (const [unit, unitMs] of ranges) {
    if (Math.abs(deltaMs) >= unitMs) {
      return formatter.format(Math.round((deltaMs / unitMs) * -1), unit);
    }
  }

  return "just now";
}

function render(prs: PullRequest[]) {
  const stamp = new Date().toLocaleString();
  console.log(
    `\n[${stamp}] Review requests (${prs.length}) — host: ${ghHost} — user: ${ghUser}` +
      (mockAuthored ? " — mode: mock-authored" : ""),
  );

  if (prs.length === 0) {
    console.log("No open review requests right now.");
    return;
  }

  for (const pr of prs) {
    const repo = repoName(pr.repository);
    const author = pr.author?.login ?? "unknown";
    const updated = timeAgo(pr.updatedAt);
    console.log(`- ${repo}#${pr.number} ${pr.title}`);
    console.log(`  ${author} • updated ${updated} • ${pr.url}`);
  }
}

async function displayOnce() {
  try {
    const prs = await fetchPullRequests();
    const ordered = prs.sort((a, b) => (a.updatedAt > b.updatedAt ? 1 : -1));
    render(ordered);
    await processNewReviews(ordered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch review requests: ${message}`);
  }
}

function prKey(pr: PullRequest): string {
  return `${repoName(pr.repository)}#${pr.number}`;
}

function stripAnsi(input: string): string {
  return input.replace(ansiPattern, "");
}

type OpencodeResult = {
  sessionId: string;
  shareUrl: string | null;
};

async function processNewReviews(prs: PullRequest[]) {
  const fresh = prs.filter((pr) => !seen.has(prKey(pr)));
  if (fresh.length === 0) return;

  console.log(`\nDetected ${fresh.length} new review request(s).`);

  for (const pr of fresh) {
    const key = prKey(pr);
    console.log(`\nLaunching Opencode review for ${key}...`);

    try {
      const result = await runOpencodeReview(pr);
      seen.add(key);
      console.log(`  Session ID: ${result.sessionId}`);
      console.log(
        `  Attach via CLI: opencode run --session ${result.sessionId}`,
      );
      if (result.shareUrl) {
        console.log(`  Share URL: ${result.shareUrl}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  Failed to run Opencode review: ${message}`);
    }
  }
}

async function runOpencodeReview(pr: PullRequest): Promise<OpencodeResult> {
  const repo = repoName(pr.repository);
  const title = `Review ${repo}#${pr.number}`;
  const prompt =
    `Please review the pull request ${pr.url}. ` +
    `Use the gh CLI skill for any repository operations or context gathering while you analyze the changes. ` +
    `Summarize key findings, risks, and follow-up actions.`;

  return new Promise<OpencodeResult>((resolve, reject) => {
    const args = [
      "run",
      "--format",
      "json",
      "--title",
      title,
      "--share",
      prompt,
    ];

    const child = spawn("opencode", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks: string[] = [];
    let sessionId: string | null = null;
    let shareUrl: string | null = null;

    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line) => {
      const stripped = stripAnsi(line).trim();
      if (!stripped) return;

      const urlMatch = stripped.match(/https?:\/\/\S+/);
      if (urlMatch && stripped.includes("opncd.ai")) {
        shareUrl = urlMatch[0];
      }

      try {
        const event = JSON.parse(stripped) as {
          sessionID?: string;
          part?: { sessionID?: string };
        };
        const candidate = event.sessionID ?? event.part?.sessionID ?? null;
        if (candidate && !sessionId) {
          sessionId = candidate;
        }
      } catch {
        // Non-JSON lines (share banner, etc.) are ignored.
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    child.on("error", (error) => {
      rl.close();
      reject(error);
    });

    child.on("close", (code) => {
      rl.close();

      if (code !== 0) {
        const stderr = stderrChunks.join("").trim();
        reject(
          new Error(
            stderr || `opencode exited with status ${code ?? "unknown"}.`,
          ),
        );
        return;
      }

      if (!sessionId) {
        const stderr = stderrChunks.join("").trim();
        reject(
          new Error(
            stderr || "opencode completed but session id was not captured.",
          ),
        );
        return;
      }

      resolve({ sessionId, shareUrl });
    });
  });
}

(async function main() {
  await displayOnce();

  const interval = setInterval(() => {
    void displayOnce();
  }, intervalMs);

  const shutdown = () => {
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
