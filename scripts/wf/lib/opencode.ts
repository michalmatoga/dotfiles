import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const ansiPattern = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:" +
    "(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007" +
    "|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-nq-uy=><~])",
  "g",
);

const stripAnsi = (value: string) => value.replace(ansiPattern, "");

export const buildOpencodeResumeCommand = (sessionId: string) => {
  return `opencode -s ${sessionId}`;
};

export const runInitialOpencode = async (options: {
  title: string;
  prompt: string;
  cwd: string;
  verbose: boolean;
}): Promise<string> => {
  const args = [
    "run",
    "--format",
    "json",
    "--title",
    options.title,
    options.prompt,
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
