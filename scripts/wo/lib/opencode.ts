import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { runCommandCapture } from "./command";

const opencodeLogDir = join(homedir(), ".local/share/opencode/log");

export const buildOpencodeResumeCommand = (sessionId: string) => `opencode -s ${sessionId}`;

const slugify = (value: string) => {
  const lowered = value.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = cleaned.replace(/^-+/, "").replace(/-+$/, "");
  if (!trimmed) {
    return "session";
  }
  return trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed;
};

const buildLogPath = (title: string) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = slugify(title);
  return join(opencodeLogDir, `wo-${stamp}-${slug}.log`);
};

const fetchSessionIdForDirectory = async (directory: string): Promise<string | null> => {
  const escaped = directory.replace(/'/g, "''");
  const query = `select id, time_updated from session where directory = '${escaped}' order by time_updated desc limit 1;`;
  try {
    const output = await runCommandCapture("opencode", ["db", "--format", "json", query]);
    const rows = JSON.parse(output) as Array<{ id?: string | null }>;
    const row = rows[0];
    return row?.id ?? null;
  } catch {
    return null;
  }
};

const waitForSessionId = async (directory: string, timeoutMs: number): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessionId = await fetchSessionIdForDirectory(directory);
    if (sessionId) {
      return sessionId;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

export const runInitialOpencode = async (options: {
  title: string;
  prompt: string;
  cwd: string;
  verbose: boolean;
}): Promise<{ sessionId: string; logPath: string }> => {
  const args = ["run", "--format", "json", "--title", options.title, options.prompt];
  await mkdir(opencodeLogDir, { recursive: true });
  const logPath = buildLogPath(options.title);
  const logFd = openSync(logPath, "a");
  if (options.verbose) {
    console.log(`$ opencode ${args.join(" ")} > ${logPath}`);
  }
  try {
    const child = spawn("opencode", args, {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }

  const sessionId = await waitForSessionId(options.cwd, 15_000);
  if (!sessionId) {
    throw new Error(`opencode session id not found within timeout; check ${logPath}`);
  }
  return { sessionId, logPath };
};
