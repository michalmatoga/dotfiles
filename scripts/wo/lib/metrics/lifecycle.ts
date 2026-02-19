import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { MetricsRecord, CardListState } from "./types";
import { formatMetricsRecord, parseMetricsRecord, getPrimaryLabel, listNames } from "./types";

const metricsPath = "scripts/wo/state/wo-metrics.csv";
const statePath = "scripts/wo/state/wo-card-states.jsonl";

const ensureDir = async (filePath: string) => {
  await mkdir(dirname(filePath), { recursive: true });
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const ensureCsvHeader = async () => {
  const exists = await fileExists(metricsPath);
  if (!exists) {
    await ensureDir(metricsPath);
    const header = "timestamp,card_id,url,event_type,list,label,seconds_in_list,completed_date\n";
    await writeFile(metricsPath, header);
  }
};

const readCardStates = async (): Promise<Map<string, CardListState>> => {
  try {
    const content = await readFile(statePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const states = new Map<string, CardListState>();
    for (const line of lines) {
      try {
        const state = JSON.parse(line) as CardListState;
        states.set(state.cardId, state);
      } catch {
        // Skip invalid lines
      }
    }
    return states;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
};

const writeCardState = async (state: CardListState) => {
  await ensureDir(statePath);
  const states = await readCardStates();
  states.set(state.cardId, state);
  const lines = Array.from(states.values()).map((s) => JSON.stringify(s));
  await writeFile(statePath, lines.join("\n") + "\n");
};

const deleteCardState = async (cardId: string) => {
  const states = await readCardStates();
  states.delete(cardId);
  const lines = Array.from(states.values()).map((s) => JSON.stringify(s));
  await writeFile(statePath, lines.join("\n") + "\n");
};

const calculateSecondsInList = (enteredAt: string, exitedAt: string): number => {
  const start = new Date(enteredAt).getTime();
  const end = new Date(exitedAt).getTime();
  return Math.floor((end - start) / 1000);
};

const getCompletedDate = (list: string): string | null => {
  if (list === listNames.done) {
    return new Date().toISOString().split("T")[0] ?? null;
  }
  return null;
};

export const recordCardMove = async (options: {
  cardId: string;
  url: string | null;
  fromList: string | null;
  toList: string;
  labels: string[];
  now?: string;
}): Promise<void> => {
  const now = options.now ?? new Date().toISOString();
  const label = getPrimaryLabel(options.labels);
  const states = await readCardStates();

  // If card was in a previous list, record the exit
  if (options.fromList) {
    const previousState = states.get(options.cardId);
    if (previousState && previousState.list === options.fromList) {
      const secondsInList = calculateSecondsInList(previousState.enteredAt, now);
      const exitRecord: MetricsRecord = {
        timestamp: now,
        cardId: options.cardId,
        url: options.url ?? previousState.url,
        eventType: "exited",
        list: options.fromList,
        label: getPrimaryLabel(previousState.labels) ?? label,
        secondsInList,
        completedDate: getCompletedDate(options.fromList),
      };

      await ensureCsvHeader();
      await writeFile(metricsPath, formatMetricsRecord(exitRecord) + "\n", { flag: "a" });
    }
  }

  // Record entry into new list
  const entryRecord: MetricsRecord = {
    timestamp: now,
    cardId: options.cardId,
    url: options.url,
    eventType: "entered",
    list: options.toList,
    label,
    secondsInList: null,
    completedDate: null,
  };

  await ensureCsvHeader();
  await writeFile(metricsPath, formatMetricsRecord(entryRecord) + "\n", { flag: "a" });

  // Update current state
  await writeCardState({
    cardId: options.cardId,
    list: options.toList,
    enteredAt: now,
    labels: options.labels,
    url: options.url,
  });
};

export const recordCardExit = async (options: {
  cardId: string;
  url: string | null;
  list: string;
  labels: string[];
  now?: string;
}): Promise<void> => {
  const now = options.now ?? new Date().toISOString();
  const states = await readCardStates();
  const state = states.get(options.cardId);

  if (!state || state.list !== options.list) {
    // Card wasn't tracked, nothing to exit
    return;
  }

  const secondsInList = calculateSecondsInList(state.enteredAt, now);
  const record: MetricsRecord = {
    timestamp: now,
    cardId: options.cardId,
    url: options.url ?? state.url,
    eventType: "exited",
    list: options.list,
    label: getPrimaryLabel(state.labels),
    secondsInList,
    completedDate: getCompletedDate(options.list),
  };

  await ensureCsvHeader();
  await writeFile(metricsPath, formatMetricsRecord(record) + "\n", { flag: "a" });
  await deleteCardState(options.cardId);
};

export const readMetrics = async (): Promise<MetricsRecord[]> => {
  try {
    const content = await readFile(metricsPath, "utf8");
    const lines = content.trim().split("\n");
    // Skip header
    const dataLines = lines.slice(1);
    return dataLines.filter(Boolean).map(parseMetricsRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const getCardMetrics = async (cardId: string): Promise<{
  touchTime: number;
  waitTime: number;
  cycleTime: number | null;
}> => {
  const metrics = await readMetrics();
  const cardMetrics = metrics.filter((m) => m.cardId === cardId);

  let touchTime = 0;
  let enteredDoingAt: string | null = null;
  let completedAt: string | null = null;

  // Sort by timestamp to process chronologically
  const sorted = cardMetrics.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const metric of sorted) {
    if (metric.eventType === "entered" && metric.list === listNames.doing) {
      enteredDoingAt = metric.timestamp;
    } else if (metric.eventType === "exited" && metric.list === listNames.doing) {
      if (metric.secondsInList) {
        touchTime += metric.secondsInList;
      }
    } else if (metric.eventType === "exited" && metric.list === listNames.done && metric.completedDate) {
      completedAt = metric.timestamp;
    }
  }

  const cycleTime = enteredDoingAt && completedAt
    ? Math.floor((new Date(completedAt).getTime() - new Date(enteredDoingAt).getTime()) / 1000)
    : null;

  const waitTime = cycleTime ? cycleTime - touchTime : 0;

  return { touchTime, waitTime, cycleTime };
};

export const getThroughput = async (options: {
  startDate: string;
  endDate: string;
  label?: string | null;
}): Promise<number> => {
  const metrics = await readMetrics();
  return metrics.filter((m) => {
    if (m.eventType !== "exited" || m.list !== listNames.done || !m.completedDate) {
      return false;
    }
    if (options.label && m.label !== options.label) {
      return false;
    }
    return m.completedDate >= options.startDate && m.completedDate <= options.endDate;
  }).length;
};
