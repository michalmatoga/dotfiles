import { appendJsonl } from "./jsonl";

export type EventRecord = {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};

const eventsPath = "scripts/wo/state/wo-events.jsonl";

export const writeEvent = async (record: EventRecord) => appendJsonl(eventsPath, record);
