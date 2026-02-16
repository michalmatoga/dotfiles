import { appendJsonl, readLastJsonlEntry } from "./jsonl";

export type ProjectMetaSnapshot = {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  fetchedAt: string;
};

export type ProjectSnapshot = {
  lastSyncAt?: string | null;
  fullRefreshAt?: string | null;
  items?: Record<string, { updatedAt: string }>
  meta?: ProjectMetaSnapshot | null;
};

export type Snapshot = {
  ts: string;
  trello?: Record<string, { listId: string; labels: string[]; syncUrl?: string | null }>;
  project?: ProjectSnapshot | null;
  worktrees?: { lastEventTs?: string | null; byUrl?: Record<string, string> } | null;
};

const snapshotPath = "scripts/wo/state/wo-snapshots.jsonl";

export const readLatestSnapshot = async (): Promise<Snapshot | null> =>
  readLastJsonlEntry<Snapshot>(snapshotPath);

export const writeSnapshot = async (snapshot: Snapshot) =>
  appendJsonl(snapshotPath, snapshot);
