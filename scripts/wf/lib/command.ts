import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runCommand = async (
  command: string,
  args: string[],
  options: { cwd?: string; dryRun?: boolean; verbose?: boolean } = {},
) => {
  if (options.verbose) {
    console.log(`${options.dryRun ? "[dry-run] " : ""}$ ${command} ${args.join(" ")}`);
  }
  if (options.dryRun) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
    });
  });
};

export const runCommandCapture = async (
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 10,
  });
  return stdout;
};
