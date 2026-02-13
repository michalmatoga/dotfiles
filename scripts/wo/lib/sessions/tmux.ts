import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { runCommand, runCommandCapture } from "../command";
import { ghJson } from "../gh/gh";
import { buildOpencodeResumeCommand, runInitialOpencode } from "../opencode";

type UrlInfo = {
  host: string;
  owner: string;
  repo: string;
  number: string;
  kind: "issue" | "pr";
};

export type SessionInitResult = {
  sessionName: string;
  sessionId: string | null;
  title: string;
  kind: "issue" | "pr";
  status: "created" | "exists";
};

const parseUrlInfo = (url: string): UrlInfo | null => {
  const match = url.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    kind: match[4] === "pull" ? "pr" : "issue",
    number: match[5],
  };
};

const sessionNameFromPath = (path: string) => {
  const home = process.env.HOME ?? "";
  const rel = path.startsWith(home) ? relative(home, path) : path;
  return rel.replace(/[/.]/g, "_");
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

const fetchTitle = async (url: string, info: UrlInfo): Promise<string> => {
  if (info.kind === "issue") {
    const response = await ghJson<{ title: string }>(["issue", "view", url, "--json", "title"], {
      host: info.host,
    });
    return response.title;
  }
  const response = await ghJson<{ title: string }>(["pr", "view", url, "--json", "title"], { host: info.host });
  return response.title;
};

const buildPrompt = async (info: UrlInfo, url: string) => {
  const promptPath = info.kind === "pr" ? "scripts/wf/prompts/review.md" : "scripts/wf/prompts/issue.md";
  const template = await readFile(promptPath, "utf8");
  const repoLabel = `${info.owner}/${info.repo}`;
  if (info.kind === "pr") {
    return template.replaceAll("[org/repo]", repoLabel).replaceAll("[pr-url]", url);
  }
  return template.replaceAll("[org/repo]", repoLabel).replaceAll("[issue-url]", url);
};

const buildTitle = (info: UrlInfo, title: string) => {
  if (info.kind === "pr") {
    return `PR${info.number}: ${title}`;
  }
  return `Issue${info.number}: ${title}`;
};

const createDetachedSession = async (options: {
  sessionName: string;
  worktreePath: string;
  opencodeResumeCommand: string;
  verbose: boolean;
}) => {
  await runCommand("tmux", ["new-session", "-d", "-s", options.sessionName, "-c", options.worktreePath], {
    verbose: options.verbose,
  });
  await runCommand("tmux", ["split-window", "-h", "-t", options.sessionName, "-c", options.worktreePath], {
    verbose: options.verbose,
  });
  await runCommand("tmux", ["resize-pane", "-t", options.sessionName, "-x", "93"], {
    verbose: options.verbose,
  });
  await runCommand("tmux", ["send-keys", "-t", options.sessionName, options.opencodeResumeCommand, "C-m"], {
    verbose: options.verbose,
  });
};

export type SessionCleanupResult = {
  sessionName: string;
  status: "removed" | "not_found";
};

export const cleanupWorkSession = async (options: {
  worktreePath: string;
  verbose: boolean;
}): Promise<SessionCleanupResult> => {
  const sessionName = sessionNameFromPath(options.worktreePath);
  if (!(await hasSession(sessionName))) {
    return { sessionName, status: "not_found" };
  }
  await runCommand("tmux", ["kill-session", "-t", sessionName], {
    verbose: options.verbose,
    allowFailure: true,
  });
  return { sessionName, status: "removed" };
};

export const initializeWorkSession = async (options: {
  url: string;
  worktreePath: string;
  verbose: boolean;
}): Promise<SessionInitResult> => {
  await ensureCommandAvailable("opencode");
  await ensureCommandAvailable("tmux");

  const info = parseUrlInfo(options.url);
  if (!info) {
    throw new Error(`Unsupported GitHub URL: ${options.url}`);
  }

  const sessionName = sessionNameFromPath(options.worktreePath);
  if (await hasSession(sessionName)) {
    return {
      sessionName,
      sessionId: null,
      title: "",
      kind: info.kind,
      status: "exists",
    };
  }

  const title = buildTitle(info, await fetchTitle(options.url, info));
  const prompt = await buildPrompt(info, options.url);
  const sessionId = await runInitialOpencode({
    title,
    prompt,
    cwd: options.worktreePath,
    verbose: options.verbose,
  });
  const opencodeResumeCommand = buildOpencodeResumeCommand(sessionId);

  await createDetachedSession({
    sessionName,
    worktreePath: options.worktreePath,
    opencodeResumeCommand,
    verbose: options.verbose,
  });

  return {
    sessionName,
    sessionId,
    title,
    kind: info.kind,
    status: "created",
  };
};
