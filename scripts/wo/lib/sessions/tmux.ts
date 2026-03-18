import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { runCommand, runCommandCapture } from "../command";
import { ghJson } from "../gh/gh";
import { buildOpencodeResumeCommand, runInitialOpencode } from "../opencode";
import { fetchCardDetailsByShortId } from "../trello/cards";

export type UrlInfo =
  | {
      host: string;
      owner: string;
      repo: string;
      number: string;
      kind: "issue" | "pr";
    }
  | {
      kind: "trello";
      shortId: string;
    };

type PromptSeed = {
  title: string;
  prefetchedContext: string;
};

type IssueViewResponse = {
  title: string;
  body: string | null;
  state: string | null;
  author: { login: string } | null;
  assignees: Array<{ login: string } | null>;
  labels: Array<{ name: string } | null>;
  comments: Array<{ author: { login: string } | null; body: string | null; createdAt: string | null }>;
};

type PrViewResponse = {
  title: string;
  body: string | null;
  state: string | null;
  isDraft: boolean;
  mergeStateStatus: string | null;
  baseRefName: string | null;
  headRefName: string | null;
  author: { login: string } | null;
  reviewRequests: Array<{ login: string } | null>;
  reviews: Array<{
    author: { login: string } | null;
    state: string;
    submittedAt: string | null;
    body: string | null;
  }>;
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ oid: string; messageHeadline: string }>;
};

export type SessionInitResult = {
  sessionName: string;
  sessionId: string | null;
  logPath?: string | null;
  title: string;
  kind: "issue" | "pr" | "trello";
  status: "created" | "exists";
};

const parseUrlInfo = (url: string): UrlInfo | null => {
  const match = url.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
  if (!match) {
    const trelloMatch = url.match(/^https:\/\/trello\.com\/c\/([^/]+)/);
    if (!trelloMatch) {
      return null;
    }
    return {
      kind: "trello",
      shortId: trelloMatch[1],
    };
  }
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    kind: match[4] === "pull" ? "pr" : "issue",
    number: match[5],
  };
};

const issueBodyMaxChars = 4_000;
const issueCommentMaxChars = 600;
const issueCommentLimit = 8;
const prBodyMaxChars = 4_000;
const prReviewBodyMaxChars = 350;
const prReviewLimit = 10;
const prFileLimit = 25;
const prCommitLimit = 12;
const trelloDescMaxChars = 4_000;
const trelloChecklistLimit = 12;
const trelloChecklistItemLimit = 15;

export const truncateForPrompt = (value: string | null | undefined, maxChars: number): string => {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\r\n/g, "\n").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars).trimEnd()}\n... [truncated]`;
};

const asBullets = (items: string[]) =>
  items.length === 0
    ? "- none"
    : items.map((item) => `- ${item}`).join("\n");

const toIso = (value: string | null | undefined) => {
  if (!value) {
    return "unknown";
  }
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) {
    return "unknown";
  }
  return new Date(ts).toISOString();
};

const fallbackPrefetchedContext = (kind: UrlInfo["kind"], message: string) =>
  [
    "## Prefetched Context",
    "",
    `- ${kind.toUpperCase()} context prefetch failed: ${message}`,
    "- Continue with careful local inspection before making changes.",
  ].join("\n");

const buildIssuePromptSeed = async (info: Extract<UrlInfo, { kind: "issue" }>, url: string): Promise<PromptSeed> => {
  const issue = await ghJson<IssueViewResponse>(
    ["issue", "view", url, "--json", "title,body,state,author,assignees,labels,comments"],
    { host: info.host },
  );

  const labels = issue.labels
    .map((label) => label?.name)
    .filter((name): name is string => Boolean(name));
  const assignees = issue.assignees
    .map((assignee) => assignee?.login)
    .filter((login): login is string => Boolean(login));
  const commentLines = issue.comments
    .slice(-issueCommentLimit)
    .map((comment, index) => {
      const author = comment.author?.login ?? "unknown";
      const createdAt = toIso(comment.createdAt);
      const body = truncateForPrompt(comment.body, issueCommentMaxChars) || "(empty comment)";
      return `${index + 1}. ${author} @ ${createdAt}\n${body}`;
    });

  const context = [
    "## Prefetched Context",
    "",
    `Issue URL: ${url}`,
    `Issue state: ${issue.state ?? "unknown"}`,
    `Author: ${issue.author?.login ?? "unknown"}`,
    "Assignees:",
    asBullets(assignees),
    "Labels:",
    asBullets(labels),
    "",
    "Issue body:",
    truncateForPrompt(issue.body, issueBodyMaxChars) || "(empty)",
    "",
    `Recent comments (latest ${Math.min(issue.comments.length, issueCommentLimit)} of ${issue.comments.length}):`,
    commentLines.length > 0 ? commentLines.join("\n\n") : "none",
  ].join("\n");

  return { title: issue.title, prefetchedContext: context };
};

const buildPrPromptSeed = async (info: Extract<UrlInfo, { kind: "pr" }>, url: string): Promise<PromptSeed> => {
  const pr = await ghJson<PrViewResponse>(
    [
      "pr",
      "view",
      url,
      "--json",
      "title,body,state,isDraft,mergeStateStatus,baseRefName,headRefName,author,reviewRequests,reviews,files,commits",
    ],
    { host: info.host },
  );

  const reviewRequests = pr.reviewRequests
    .map((request) => request?.login)
    .filter((login): login is string => Boolean(login));
  const files = pr.files
    .slice(0, prFileLimit)
    .map((file) => `${file.path} (+${file.additions} / -${file.deletions})`);
  const commits = pr.commits
    .slice(0, prCommitLimit)
    .map((commit) => `${commit.oid.slice(0, 8)} ${commit.messageHeadline}`);
  const meaningfulReviews = pr.reviews
    .filter((review) => review.state !== "COMMENTED")
    .slice(-prReviewLimit)
    .map((review, index) => {
      const author = review.author?.login ?? "unknown";
      const submittedAt = toIso(review.submittedAt);
      const body = truncateForPrompt(review.body, prReviewBodyMaxChars);
      const details = body ? `\n${body}` : "";
      return `${index + 1}. ${author} - ${review.state} @ ${submittedAt}${details}`;
    });

  const context = [
    "## Prefetched Context",
    "",
    `PR URL: ${url}`,
    `PR state: ${pr.state ?? "unknown"}`,
    `Draft: ${pr.isDraft ? "yes" : "no"}`,
    `Merge state: ${pr.mergeStateStatus ?? "unknown"}`,
    `Author: ${pr.author?.login ?? "unknown"}`,
    `Base <- Head: ${pr.baseRefName ?? "?"} <- ${pr.headRefName ?? "?"}`,
    "Review requests:",
    asBullets(reviewRequests),
    "",
    "PR body:",
    truncateForPrompt(pr.body, prBodyMaxChars) || "(empty)",
    "",
    `Changed files (first ${Math.min(pr.files.length, prFileLimit)} of ${pr.files.length}):`,
    asBullets(files),
    "",
    `Commit headlines (first ${Math.min(pr.commits.length, prCommitLimit)} of ${pr.commits.length}):`,
    asBullets(commits),
    "",
    `Non-comment reviews (latest ${Math.min(meaningfulReviews.length, prReviewLimit)}):`,
    meaningfulReviews.length > 0 ? meaningfulReviews.join("\n") : "none",
  ].join("\n");

  return { title: pr.title, prefetchedContext: context };
};

const buildTrelloPromptSeed = async (
  info: Extract<UrlInfo, { kind: "trello" }>,
  url: string,
  providedTitle?: string | null,
): Promise<PromptSeed> => {
  const card = await fetchCardDetailsByShortId(info.shortId);
  const labels = (Array.isArray(card.labels) ? card.labels : [])
    .map((label) => {
      const name = label.name?.trim();
      if (name) {
        return `${name}${label.color ? ` (${label.color})` : ""}`;
      }
      return label.color ? `(unnamed, ${label.color})` : "(unnamed)";
    })
    .filter(Boolean);

  const checklists = Array.isArray(card.checklists) ? card.checklists : [];
  const checklistLines = checklists.slice(0, trelloChecklistLimit).map((checklist) => {
    const checkItems = Array.isArray(checklist.checkItems) ? checklist.checkItems : [];
    const items = checkItems
      .slice(0, trelloChecklistItemLimit)
      .map((item) => `${item.state === "complete" ? "[x]" : "[ ]"} ${item.name}`);
    const extra = checkItems.length > trelloChecklistItemLimit
      ? `\n  ... (${checkItems.length - trelloChecklistItemLimit} more items)`
      : "";
    return `- ${checklist.name}\n  ${items.join("\n  ")}${extra}`;
  });

  const extraChecklists = checklists.length > trelloChecklistLimit
    ? `\n... (${checklists.length - trelloChecklistLimit} more checklists)`
    : "";

  const context = [
    "## Prefetched Context",
    "",
    `Trello URL: ${url}`,
    `Card URL: ${card.url ?? card.shortUrl ?? url}`,
    "Labels:",
    asBullets(labels),
    "",
    "Card description:",
    truncateForPrompt(card.desc, trelloDescMaxChars) || "(empty)",
    "",
    "Checklists:",
    checklistLines.length > 0 ? `${checklistLines.join("\n")}${extraChecklists}` : "none",
  ].join("\n");

  return {
    title: card.name || providedTitle || "Trello Card",
    prefetchedContext: context,
  };
};

export const buildPromptSeed = async (options: {
  info: UrlInfo;
  url: string;
  providedTitle?: string | null;
}): Promise<PromptSeed> => {
  const { info, url, providedTitle } = options;
  try {
    if (info.kind === "issue") {
      return await buildIssuePromptSeed(info, url);
    }
    if (info.kind === "pr") {
      return await buildPrPromptSeed(info, url);
    }
    return await buildTrelloPromptSeed(info, url, providedTitle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackTitle =
      providedTitle
      ?? (info.kind === "pr" ? "Pull Request" : info.kind === "issue" ? "Issue" : "Trello Card");
    if (info.kind === "issue" || info.kind === "pr") {
      try {
        const response = await ghJson<{ title: string }>(
          [info.kind === "issue" ? "issue" : "pr", "view", url, "--json", "title"],
          { host: info.host },
        );
        return {
          title: response.title,
          prefetchedContext: fallbackPrefetchedContext(info.kind, message),
        };
      } catch {
        return {
          title: fallbackTitle,
          prefetchedContext: fallbackPrefetchedContext(info.kind, message),
        };
      }
    }
    return {
      title: fallbackTitle,
      prefetchedContext: fallbackPrefetchedContext(info.kind, message),
    };
  }
};

const sessionNameFromPath = (path: string) => {
  const home = process.env.HOME ?? "";
  const rel = path.startsWith(home) ? relative(home, path) : path;
  return rel.replace(/[/.]/g, "_");
};

const normalizePath = (value: string) => value.replace(/\/+$/, "");

const expandPathAliases = (path: string): string[] => {
  const normalized = normalizePath(path);
  const aliases = new Set<string>([normalized]);
  const home = process.env.HOME ?? "";
  if (!home || !normalized.startsWith(home)) {
    return Array.from(aliases);
  }

  const rel = relative(home, normalized);
  const segments = rel.split("/").filter(Boolean);
  if (segments.length < 4) {
    return Array.from(aliases);
  }

  const root = segments[0];
  const host = segments[1];
  const owner = segments[2];
  const repoSegment = segments[3];
  if (!host || !owner || !repoSegment) {
    return Array.from(aliases);
  }

  if (root === "ghq") {
    const separatorIndex = repoSegment.indexOf("=");
    if (separatorIndex > 0) {
      const repo = repoSegment.slice(0, separatorIndex);
      const leaf = repoSegment.slice(separatorIndex + 1);
      if (repo && leaf) {
        aliases.add(join(home, "gwq", host, owner, repo, leaf));
      }
    }
  }

  if (root === "gwq" && segments.length >= 5) {
    const repo = repoSegment;
    const leaf = segments[4];
    if (repo && leaf) {
      aliases.add(join(home, "ghq", host, owner, `${repo}=${leaf}`));
    }
  }

  return Array.from(aliases);
};

const killSessionIfPresent = async (sessionName: string, verbose: boolean): Promise<boolean> => {
  if (!(await hasSession(sessionName))) {
    return false;
  }
  await runCommand("tmux", ["kill-session", "-t", sessionName], {
    verbose,
    allowFailure: true,
  });
  return true;
};

const ensureCommandAvailable = async (command: string) => {
  await runCommandCapture("which", [command]);
};

const hasSession = async (sessionName: string): Promise<boolean> => {
  try {
    await runCommandCapture("tmux", ["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
};

const buildPrompt = async (info: UrlInfo, url: string, title: string | null, prefetchedContext: string) => {
  const promptPath =
    info.kind === "pr"
      ? "scripts/wo/prompts/review.md"
      : info.kind === "issue"
        ? "scripts/wo/prompts/issue.md"
        : "scripts/wo/prompts/trello.md";
  const template = await readFile(promptPath, "utf8");
  if (info.kind === "trello") {
    return template
      .replaceAll("[trello-url]", url)
      .replaceAll("[card-title]", title ?? "Trello Card")
      .replaceAll("[prefetched-context]", prefetchedContext);
  }
  const repoLabel = `${info.owner}/${info.repo}`;
  if (info.kind === "pr") {
    return template
      .replaceAll("[org/repo]", repoLabel)
      .replaceAll("[pr-url]", url)
      .replaceAll("[prefetched-context]", prefetchedContext);
  }
  return template
    .replaceAll("[org/repo]", repoLabel)
    .replaceAll("[issue-url]", url)
    .replaceAll("[prefetched-context]", prefetchedContext);
};

const buildTitle = (info: UrlInfo, title: string) => {
  if (info.kind === "trello") {
    return `Trello: ${title}`;
  }
  if (info.kind === "pr") {
    return `PR${info.number}: ${title}`;
  }
  return `Issue${info.number}: ${title}`;
};

const createDetachedSession = async (options: {
  sessionName: string;
  worktreePath: string;
  opencodeResumeCommand?: string | null;
  verbose: boolean;
}) => {
  await runCommand("tmux", ["new-session", "-d", "-s", options.sessionName, "-c", options.worktreePath], {
    verbose: options.verbose,
  });
  await runCommand("tmux", ["split-window", "-h", "-t", options.sessionName, "-c", options.worktreePath], {
    verbose: options.verbose,
  });
  await runCommand("tmux", ["resize-pane", "-t", options.sessionName, "-x", "92"], {
    verbose: options.verbose,
  });
  if (options.opencodeResumeCommand) {
    await runCommand("tmux", ["send-keys", "-t", options.sessionName, options.opencodeResumeCommand, "C-m"], {
      verbose: options.verbose,
    });
  }
};

export type SessionCleanupResult = {
  sessionName: string;
  status: "removed" | "not_found";
};

export const cleanupWorkSession = async (options: {
  worktreePath: string;
  verbose: boolean;
}): Promise<SessionCleanupResult> => {
  const aliasPaths = expandPathAliases(options.worktreePath);
  const candidateSessionNames = Array.from(new Set(aliasPaths.map((path) => sessionNameFromPath(path))));

  for (const sessionName of candidateSessionNames) {
    const removed = await killSessionIfPresent(sessionName, options.verbose);
    if (removed) {
      return { sessionName, status: "removed" };
    }
  }

  const aliasPathSet = new Set(aliasPaths.map((path) => normalizePath(path)));
  let output = "";
  try {
    output = await runCommandCapture("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_current_path}"]);
  } catch {
    return { sessionName: candidateSessionNames[0] ?? sessionNameFromPath(options.worktreePath), status: "not_found" };
  }

  const matchingSessions = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [sessionName, panePathRaw] = trimmed.split("\t");
    if (!sessionName || !panePathRaw) {
      continue;
    }
    const panePath = normalizePath(panePathRaw);
    const isMatching = Array.from(aliasPathSet).some((aliasPath) => panePath === aliasPath || panePath.startsWith(`${aliasPath}/`));
    if (isMatching) {
      matchingSessions.add(sessionName);
    }
  }

  for (const sessionName of matchingSessions) {
    const removed = await killSessionIfPresent(sessionName, options.verbose);
    if (removed) {
      return { sessionName, status: "removed" };
    }
  }

  return { sessionName: candidateSessionNames[0] ?? sessionNameFromPath(options.worktreePath), status: "not_found" };
};

export const initializeWorkSession = async (options: {
  url: string;
  worktreePath: string;
  title?: string | null;
  verbose: boolean;
}): Promise<SessionInitResult> => {
  let opencodeAvailable = true;
  try {
    await ensureCommandAvailable("opencode");
  } catch (error) {
    opencodeAvailable = false;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`opencode unavailable: ${message}`);
  }
  await ensureCommandAvailable("tmux");

  const info = parseUrlInfo(options.url);
  if (!info) {
    throw new Error(`Unsupported URL: ${options.url}`);
  }

  const sessionName = sessionNameFromPath(options.worktreePath);
  if (await hasSession(sessionName)) {
    return {
      sessionName,
      sessionId: null,
      logPath: null,
      title: "",
      kind: info.kind,
      status: "exists",
    };
  }

  const seed = await buildPromptSeed({
    info,
    url: options.url,
    providedTitle: options.title ?? null,
  });
  const fetchedTitle = options.title ?? seed.title;
  const title = buildTitle(info, fetchedTitle);
  const prompt = await buildPrompt(info, options.url, fetchedTitle, seed.prefetchedContext);
  let sessionId: string | null = null;
  let logPath: string | null = null;
  let opencodeResumeCommand: string | null = null;
  if (opencodeAvailable) {
    try {
      const result = await runInitialOpencode({
        title,
        prompt,
        cwd: options.worktreePath,
        verbose: options.verbose,
      });
      sessionId = result.sessionId;
      logPath = result.logPath;
      opencodeResumeCommand = buildOpencodeResumeCommand(result.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`opencode failed: ${message}`);
    }
  }

  await createDetachedSession({
    sessionName,
    worktreePath: options.worktreePath,
    opencodeResumeCommand,
    verbose: options.verbose,
  });

  return {
    sessionName,
    sessionId,
    logPath,
    title,
    kind: info.kind,
    status: "created",
  };
};
