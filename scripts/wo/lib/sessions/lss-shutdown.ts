import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { runCommand, runCommandCapture } from "../command";
import { loadLssAreas } from "../trello/lss-areas";

const LSS_ROOT_NOTE = "lss.md";

export type LssShutdownContext = {
  committed: boolean;
  commitHash: string | null;
  changedFiles: string[];
  diff: string;
};

const ensureMdSuffix = (noteId: string): string =>
  noteId.endsWith(".md") ? noteId : `${noteId}.md`;

export const parseLssComponentNoteIds = (markdown: string): string[] => {
  const lines = markdown.split("\n");
  const noteIds: string[] = [];
  let inComponents = false;

  for (const line of lines) {
    if (/^##\s+Components\s*$/i.test(line.trim())) {
      inComponents = true;
      continue;
    }

    if (inComponents && /^##\s+/.test(line.trim())) {
      break;
    }

    if (!inComponents) {
      continue;
    }

    const matches = [...line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)];
    for (const match of matches) {
      const noteId = (match[1] ?? "").trim();
      if (!noteId) {
        continue;
      }
      noteIds.push(noteId);
    }
  }

  return noteIds;
};

export const resolveLssScopeRelativePaths = (options: {
  rootMarkdown: string;
  fallbackNoteIds: string[];
}): string[] => {
  const fromComponents = parseLssComponentNoteIds(options.rootMarkdown);
  const all = [
    LSS_ROOT_NOTE,
    ...fromComponents.map(ensureMdSuffix),
    ...options.fallbackNoteIds.map(ensureMdSuffix),
  ];
  const unique = new Set(
    all
      .map((entry) => basename(entry.trim()))
      .filter((entry) => entry.length > 0),
  );
  return [...unique];
};

const defaultFallbackNoteIds = async (): Promise<string[]> => {
  const areas = await loadLssAreas();
  return areas.map((area) => area.noteId);
};

const readLssRootMarkdown = async (journalPath: string): Promise<string> => {
  try {
    return await readFile(join(journalPath, LSS_ROOT_NOTE), "utf8");
  } catch {
    return "";
  }
};

const collectScopedChangedFiles = async (journalPath: string, scopedFiles: string[]): Promise<string[]> => {
  const names = await runCommandCapture(
    "git",
    ["diff", "--name-only", "HEAD", "--", ...scopedFiles],
    { cwd: journalPath },
  );
  return names
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const collectScopedDiff = async (journalPath: string, scopedFiles: string[]): Promise<string> =>
  runCommandCapture(
    "git",
    ["diff", "--no-color", "--patch", "--stat", "HEAD", "--", ...scopedFiles],
    { cwd: journalPath },
  );

export const createLssShutdownPreview = async (options: {
  journalPath: string;
  fallbackNoteIds?: string[];
}): Promise<LssShutdownContext> => {
  const rootMarkdown = await readLssRootMarkdown(options.journalPath);
  const fallbackNoteIds = options.fallbackNoteIds ?? await defaultFallbackNoteIds();
  const scopedFiles = resolveLssScopeRelativePaths({ rootMarkdown, fallbackNoteIds });
  const changedFiles = await collectScopedChangedFiles(options.journalPath, scopedFiles);
  const diff = changedFiles.length > 0
    ? await collectScopedDiff(options.journalPath, scopedFiles)
    : "";

  return {
    committed: changedFiles.length > 0,
    commitHash: null,
    changedFiles,
    diff,
  };
};

export const createLssShutdownCheckpoint = async (options: {
  journalPath: string;
  commitMessage?: string;
  fallbackNoteIds?: string[];
}): Promise<LssShutdownContext> => {
  const rootMarkdown = await readLssRootMarkdown(options.journalPath);
  const fallbackNoteIds = options.fallbackNoteIds ?? await defaultFallbackNoteIds();
  const scopedFiles = resolveLssScopeRelativePaths({ rootMarkdown, fallbackNoteIds });

  const status = await runCommandCapture(
    "git",
    ["status", "--porcelain", "--", ...scopedFiles],
    { cwd: options.journalPath },
  );

  if (!status.trim()) {
    return {
      committed: false,
      commitHash: null,
      changedFiles: [],
      diff: "",
    };
  }

  await runCommand("git", ["add", "--", ...scopedFiles], {
    cwd: options.journalPath,
  });

  const stagedNames = await runCommandCapture(
    "git",
    ["diff", "--cached", "--name-only", "--", ...scopedFiles],
    { cwd: options.journalPath },
  );
  const changedFiles = stagedNames
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (changedFiles.length === 0) {
    return {
      committed: false,
      commitHash: null,
      changedFiles: [],
      diff: "",
    };
  }

  const commitMessage = options.commitMessage ?? "chore(lss): checkpoint area developments before shutdown";
  await runCommand("git", ["commit", "-m", commitMessage, "--", ...changedFiles], {
    cwd: options.journalPath,
  });

  const commitHash = (await runCommandCapture("git", ["rev-parse", "HEAD"], {
    cwd: options.journalPath,
  })).trim();

  const diff = await runCommandCapture(
    "git",
    ["show", "--no-color", "--patch", "--stat", commitHash, "--", ...changedFiles],
    { cwd: options.journalPath },
  );

  return {
    committed: true,
    commitHash,
    changedFiles,
    diff,
  };
};
