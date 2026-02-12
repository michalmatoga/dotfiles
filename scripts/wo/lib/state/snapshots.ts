import { appendJsonl, readLastJsonlEntry } from "./jsonl";

export type Snapshot = {
  ts: string;
  trello: Record<string, { listId: string; labels: string[]; syncUrl?: string | null }>;
};

const snapshotPath = "scripts/wo/state/wf-snapshots.jsonl";

export const readLatestSnapshot = async (): Promise<Snapshot | null> =>
  readLastJsonlEntry<Snapshot>(snapshotPath);

export const writeSnapshot = async (snapshot: Snapshot) =>
  appendJsonl(snapshotPath, snapshot);
