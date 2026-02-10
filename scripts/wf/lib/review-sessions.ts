import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { runCommand } from "./command";
import { type ReviewRequest } from "./review-requests";

type ReviewSessionsOptions = {
  host: string;
  workspaceRoot: string;
  promptPath: string;
  dryRun: boolean;
  verbose: boolean;
};

const ensureBareRepo = async (
  barePath: string,
  cloneUrl: string,
  options: { dryRun: boolean; verbose: boolean },
) => {
  await mkdir(barePath, { recursive: true });
  const headPath = join(barePath, "HEAD");
  const hasHead = await access(headPath).then(
    () => true,
    () => false,
  );

  if (!hasHead) {
    await runCommand("git", ["init", "--bare", barePath], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  }

  await runCommand("git", ["-C", barePath, "remote", "get-url", "origin"], {
    dryRun: options.dryRun,
    verbose: options.verbose,
  })
    .then(async () => {
      await runCommand("git", ["-C", barePath, "remote", "set-url", "origin", cloneUrl], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    })
    .catch(async () => {
      await runCommand("git", ["-C", barePath, "remote", "add", "origin", cloneUrl], {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    });
};

const ansiPattern = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:" +
    "(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007" +
    "|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-nq-uy=><~])",
  "g",
);

const stripAnsi = (value: string) => value.replace(ansiPattern, "");

const buildOpencodeResumeCommand = (sessionId: string) => {
  return `opencode -s ${sessionId}`;
};

const runInitialOpencode = async (options: {
  title: string;
  promptFileName: string;
  cwd: string;
  verbose: boolean;
}): Promise<string> => {
  const args = [
    "run",
    "Review using attached prompt file.",
    "--file",
    options.promptFileName,
    "--format",
    "json",
    "--title",
    options.title,
  ];

  if (options.verbose) {
    console.log(`$ opencode ${args.join(" ")}`);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn("opencode", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks: string[] = [];
    let sessionId: string | null = null;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const stripped = stripAnsi(line).trim();
      if (!stripped) {
        return;
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
        // ignore non-json lines
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
        reject(new Error(stderr || `opencode exited with status ${code ?? "unknown"}.`));
        return;
      }
      if (!sessionId) {
        const stderr = stderrChunks.join("").trim();
        reject(new Error(stderr || "opencode completed but session id was not captured."));
        return;
      }
      resolve(sessionId);
    });
  });
};

export const runReviewSessions = async (
  requests: ReviewRequest[],
  options: ReviewSessionsOptions,
) => {
  if (requests.length === 0) {
    return;
  }

  const promptTemplate = await readFile(options.promptPath, "utf8");

  for (const request of requests) {
    if (!request.repo) {
      console.log(`Skip review without repo slug: ${request.url}`);
      continue;
    }

    const [org, repo] = request.repo.split("/");
    const prNumber = request.url.split("/pull/")[1];
    const bareRepoPath = join(options.workspaceRoot, org, `${repo}.git`);
    const worktreePath = join(options.workspaceRoot, org, repo, `pr-${prNumber}`);
    const cloneUrl = `schibsted@${options.host}:${request.repo}.git`;

    await ensureBareRepo(bareRepoPath, cloneUrl, options);
    await runCommand("git", ["-C", bareRepoPath, "fetch", "origin", "+refs/pull/*/head:refs/pull/*"], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    await mkdir(worktreePath, { recursive: true });
    await runCommand(
      "git",
      ["-C", bareRepoPath, "worktree", "add", "--force", worktreePath, `refs/pull/${prNumber}`],
      { dryRun: options.dryRun, verbose: options.verbose },
    );

    const title = `Review ${request.repo}#${prNumber}`;
    const prompt = promptTemplate
      .replaceAll("[org/repo]", request.repo)
      .replaceAll("[pr-url]", request.url);
    const promptFileName = ".wf-review-prompt.txt";
    const promptFile = join(worktreePath, promptFileName);
    if (!options.dryRun) {
      await writeFile(promptFile, prompt, "utf8");
    }
    const sessionId = await runInitialOpencode({
      title,
      promptFileName,
      cwd: worktreePath,
      verbose: options.verbose,
    });
    const opencodeCmd = buildOpencodeResumeCommand(sessionId);

    const aoeArgs = [
      "add",
      worktreePath,
      "--title",
      title,
      "--group",
      `reviews/${options.host}/${request.repo}`,
      "--cmd",
      opencodeCmd,
    ];

    await runCommand("aoe", aoeArgs, { dryRun: options.dryRun, verbose: options.verbose });
    await runCommand("aoe", ["session", "start", title], {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  }
};
