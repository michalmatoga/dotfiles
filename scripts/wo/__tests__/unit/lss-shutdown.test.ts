import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

vi.mock("../../lib/command", () => ({
  runCommandCapture: async (command: string, args: string[], options: { cwd?: string } = {}) => {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env },
      maxBuffer: 1024 * 1024 * 10,
    });
    return stdout;
  },
  runCommand: async (
    command: string,
    args: string[],
    options: { cwd?: string; allowFailure?: boolean } = {},
  ) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 || options.allowFailure) {
          resolve();
          return;
        }
        reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
      });
    });
  },
}));

import {
  createLssShutdownCheckpoint,
  createLssShutdownPreview,
  parseLssComponentNoteIds,
  resolveLssScopeRelativePaths,
} from "../../lib/sessions/lss-shutdown";
import { runCommand, runCommandCapture } from "../../lib/command";

describe("LSS shutdown checkpoint", () => {
  beforeEach(() => {
    process.env.GIT_AUTHOR_NAME = "Test User";
    process.env.GIT_AUTHOR_EMAIL = "test@example.com";
    process.env.GIT_COMMITTER_NAME = "Test User";
    process.env.GIT_COMMITTER_EMAIL = "test@example.com";
  });

  it("parses note ids from Components section wiki links", () => {
    const markdown = [
      "# Life Satisfaction System",
      "",
      "## Components",
      "- [[ot-business|Business]]",
      "- [[growth]]",
      "",
      "## Objectives",
      "- x",
    ].join("\n");

    expect(parseLssComponentNoteIds(markdown)).toEqual(["ot-business", "growth"]);
  });

  it("includes root note, parsed components, and fallback ids", () => {
    const scope = resolveLssScopeRelativePaths({
      rootMarkdown: "## Components\n- [[ot-business|Business]]\n",
      fallbackNoteIds: ["ot-career"],
    });

    expect(scope).toEqual(expect.arrayContaining(["lss.md", "ot-business.md", "ot-career.md"]));
  });

  it("commits only scoped LSS files", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wo-lss-shutdown-"));
    await mkdir(repo, { recursive: true });

    const lss = join(repo, "lss.md");
    const business = join(repo, "ot-business.md");
    const career = join(repo, "ot-career.md");
    const daily = join(repo, "2026-03-20.md");

    await writeFile(lss, "# LSS\n\n## Components\n- [[ot-business|Business]]\n- [[ot-career|Career]]\n");
    await writeFile(business, "initial business\n");
    await writeFile(career, "initial career\n");
    await writeFile(daily, "daily entry\n");

    await runCommand("git", ["init"], { cwd: repo });
    await runCommand("git", ["add", "--", "lss.md", "ot-business.md", "ot-career.md", "2026-03-20.md"], { cwd: repo });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: repo });

    await writeFile(business, "updated business\n");
    await writeFile(daily, "daily entry\nupdated\n");

    const checkpoint = await createLssShutdownCheckpoint({
      journalPath: repo,
      fallbackNoteIds: ["ot-business", "ot-career"],
    });

    expect(checkpoint.committed).toBe(true);
    expect(checkpoint.changedFiles).toEqual(["ot-business.md"]);
    expect(checkpoint.diff).toContain("ot-business.md");
    expect(checkpoint.diff).not.toContain("2026-03-20.md");

    const message = await runCommandCapture("git", ["log", "-1", "--pretty=%s"], { cwd: repo });
    expect(message.trim()).toBe("chore(lss): checkpoint area developments before shutdown");

    const gitStatus = await runCommandCapture("git", ["status", "--short"], { cwd: repo });
    expect(gitStatus).toContain(" M 2026-03-20.md");
  });

  it("builds shutdown dry-run context without committing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wo-lss-preview-"));
    await mkdir(repo, { recursive: true });

    await writeFile(repo + "/lss.md", "# LSS\n\n## Components\n- [[growth|Growth]]\n");
    await writeFile(repo + "/growth.md", "old\n");
    await writeFile(repo + "/2026-03-20.md", "daily\n");

    await runCommand("git", ["init"], { cwd: repo });
    await runCommand("git", ["add", "--", "lss.md", "growth.md", "2026-03-20.md"], { cwd: repo });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: repo });

    await writeFile(repo + "/growth.md", "new\n");
    await writeFile(repo + "/2026-03-20.md", "daily changed\n");

    const preview = await createLssShutdownPreview({
      journalPath: repo,
      fallbackNoteIds: ["growth"],
    });

    expect(preview.committed).toBe(true);
    expect(preview.commitHash).toBeNull();
    expect(preview.changedFiles).toEqual(["growth.md"]);
    expect(preview.diff).toContain("growth.md");
    expect(preview.diff).not.toContain("2026-03-20.md");

    const commits = await runCommandCapture("git", ["rev-list", "--count", "HEAD"], { cwd: repo });
    expect(commits.trim()).toBe("1");
  });
});
