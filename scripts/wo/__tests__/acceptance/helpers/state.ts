import * as fs from "node:fs/promises";
import * as path from "node:path";

// State files used by wo system
const STATE_DIR = path.join(__dirname, "..", "..", "..", "state");
const STATE_FILES = ["wf-events.jsonl", "wf-snapshots.jsonl"];

// Test-specific state directory (isolated from production state)
const TEST_STATE_DIR = path.join(__dirname, "..", "state");

/**
 * Clear state files for test isolation.
 * Uses a separate test state directory to avoid touching production state.
 */
export const clearStateFiles = async () => {
  // Ensure test state directory exists
  await fs.mkdir(TEST_STATE_DIR, { recursive: true });

  // Clear/create empty state files
  for (const file of STATE_FILES) {
    const filePath = path.join(TEST_STATE_DIR, file);
    await fs.writeFile(filePath, "");
  }
};

/**
 * Get the path to a test state file.
 */
export const getTestStatePath = (filename: string): string => {
  return path.join(TEST_STATE_DIR, filename);
};

/**
 * Read events from test state file.
 */
export const readTestEvents = async <T>(): Promise<T[]> => {
  const filePath = path.join(TEST_STATE_DIR, "wf-events.jsonl");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
};

/**
 * Read latest snapshot from test state file.
 */
export const readTestSnapshot = async <T>(): Promise<T | null> => {
  const filePath = path.join(TEST_STATE_DIR, "wf-snapshots.jsonl");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]) as T;
  } catch {
    return null;
  }
};

/**
 * Write a test event to state file.
 */
export const writeTestEvent = async <T>(event: T): Promise<void> => {
  const filePath = path.join(TEST_STATE_DIR, "wf-events.jsonl");
  await fs.appendFile(filePath, JSON.stringify(event) + "\n");
};

/**
 * Seed test state with initial events.
 */
export const seedTestEvents = async <T>(events: T[]): Promise<void> => {
  await fs.mkdir(TEST_STATE_DIR, { recursive: true });
  const filePath = path.join(TEST_STATE_DIR, "wf-events.jsonl");
  if (events.length === 0) {
    await fs.writeFile(filePath, "");
    return;
  }
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.writeFile(filePath, content);
};

/**
 * Seed test state with a snapshot.
 */
export const seedTestSnapshot = async <T>(snapshot: T): Promise<void> => {
  await fs.mkdir(TEST_STATE_DIR, { recursive: true });
  const filePath = path.join(TEST_STATE_DIR, "wf-snapshots.jsonl");
  await fs.writeFile(filePath, JSON.stringify(snapshot) + "\n");
};
