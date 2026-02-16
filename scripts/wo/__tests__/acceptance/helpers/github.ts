import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitHubIssue = {
  number: number;
  title: string;
  url: string;
  state: string;
};

type GitHubPR = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
};

// Track created issues/PRs for cleanup
const createdIssueNumbers: number[] = [];

/**
 * Get test repo and host from environment.
 */
const getTestRepo = (): { repo: string; host: string } => {
  const repo = process.env.GH_TEST_REPO ?? "michal-matoga/utils";
  const host = process.env.GH_HOST ?? "schibsted.ghe.com";
  return { repo, host };
};

/**
 * Run gh CLI command against test repo.
 */
const ghCommand = async (args: string[]): Promise<string> => {
  const { host } = getTestRepo();
  const { stdout } = await execFileAsync("gh", args, {
    env: { ...process.env, GH_HOST: host },
    maxBuffer: 1024 * 1024 * 10,
  });
  return stdout;
};

/**
 * Create a test issue (will be cleaned up after test).
 */
export const createTestIssue = async (options: {
  title: string;
  body?: string;
}): Promise<GitHubIssue> => {
  const { repo } = getTestRepo();

  const output = await ghCommand([
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    `[TEST] ${options.title}`,
    "--body",
    options.body ?? "Created by acceptance test",
    "--json",
    "number,title,url,state",
  ]);

  const issue = JSON.parse(output) as GitHubIssue;
  createdIssueNumbers.push(issue.number);
  return issue;
};

/**
 * Close a test issue.
 */
export const closeTestIssue = async (issueNumber: number): Promise<void> => {
  const { repo } = getTestRepo();

  await ghCommand([
    "issue",
    "close",
    "--repo",
    repo,
    String(issueNumber),
  ]);
};

/**
 * Get an issue by number.
 */
export const getTestIssue = async (issueNumber: number): Promise<GitHubIssue> => {
  const { repo } = getTestRepo();

  const output = await ghCommand([
    "issue",
    "view",
    "--repo",
    repo,
    String(issueNumber),
    "--json",
    "number,title,url,state",
  ]);

  return JSON.parse(output) as GitHubIssue;
};

/**
 * List open issues on test repo.
 */
export const listTestIssues = async (): Promise<GitHubIssue[]> => {
  const { repo } = getTestRepo();

  const output = await ghCommand([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,url,state",
  ]);

  return JSON.parse(output) as GitHubIssue[];
};

/**
 * Get PR details by number.
 */
export const getTestPR = async (prNumber: number): Promise<GitHubPR> => {
  const { repo } = getTestRepo();

  const output = await ghCommand([
    "pr",
    "view",
    "--repo",
    repo,
    String(prNumber),
    "--json",
    "number,title,url,state,isDraft",
  ]);

  return JSON.parse(output) as GitHubPR;
};

/**
 * List open PRs on test repo.
 */
export const listTestPRs = async (): Promise<GitHubPR[]> => {
  const { repo } = getTestRepo();

  const output = await ghCommand([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,url,state,isDraft",
  ]);

  return JSON.parse(output) as GitHubPR[];
};

/**
 * Clean up all issues created during tests.
 * Closes issues rather than deleting (GitHub doesn't allow deletion via API).
 */
export const cleanupTestIssues = async (): Promise<void> => {
  for (const issueNumber of createdIssueNumbers) {
    try {
      await closeTestIssue(issueNumber);
    } catch {
      // Ignore errors (issue may already be closed)
    }
  }
  createdIssueNumbers.length = 0;
};

/**
 * Build a GitHub URL for an issue in the test repo.
 */
export const buildTestIssueUrl = (issueNumber: number): string => {
  const { repo, host } = getTestRepo();
  return `https://${host}/${repo}/issues/${issueNumber}`;
};

/**
 * Build a GitHub URL for a PR in the test repo.
 */
export const buildTestPRUrl = (prNumber: number): string => {
  const { repo, host } = getTestRepo();
  return `https://${host}/${repo}/pull/${prNumber}`;
};
