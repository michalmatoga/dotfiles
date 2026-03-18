import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { MetricsRecord, CardListState } from "./types";
import { formatMetricsRecord, parseMetricsRecord, getPrimaryLabel, listNames } from "./types";

const defaultStateDir = "scripts/wo/state";
const getStateDir = (): string => process.env.WO_METRICS_STATE_DIR ?? defaultStateDir;
const getMetricsPath = (): string => `${getStateDir()}/wo-metrics.csv`;
const getCardStatePath = (): string => `${getStateDir()}/wo-card-states.jsonl`;

const normalizeTrackedUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const markdownMatch = trimmed.match(/^\[[^\]]+\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)$/i);
  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }
  const firstUrlMatch = trimmed.match(/https?:\/\/[^\s)\]"]+/i);
  if (firstUrlMatch?.[0]) {
    return firstUrlMatch[0];
  }
  return trimmed;
};

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
  const metricsPath = getMetricsPath();
  const exists = await fileExists(metricsPath);
  if (!exists) {
    await ensureDir(metricsPath);
    const header = "timestamp,card_id,url,event_type,list,label,seconds_in_list,completed_date\n";
    await writeFile(metricsPath, header);
  }
};

const readCardStates = async (): Promise<Map<string, CardListState>> => {
  const statePath = getCardStatePath();
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
  const statePath = getCardStatePath();
  await ensureDir(statePath);
  const states = await readCardStates();
  states.set(state.cardId, state);
  const lines = Array.from(states.values()).map((s) => JSON.stringify(s));
  await writeFile(statePath, lines.join("\n") + "\n");
};

const deleteCardState = async (cardId: string) => {
  const statePath = getCardStatePath();
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

const getCompletedDate = (options: {
  list: string;
  eventType: "entered" | "exited";
  now: string;
}): string | null => {
  if (options.list === listNames.done && options.eventType === "entered") {
    return options.now.split("T")[0] ?? null;
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
  const trackedUrl = normalizeTrackedUrl(options.url);
  const label = getPrimaryLabel(options.labels);
  const states = await readCardStates();

  const currentState = states.get(options.cardId);
  if (currentState && currentState.list === options.toList) {
    return;
  }

  // If card was in a previous list, record the exit
  if (options.fromList) {
    const previousState = states.get(options.cardId);
    if (previousState && previousState.list === options.fromList) {
      const secondsInList = calculateSecondsInList(previousState.enteredAt, now);
      const exitRecord: MetricsRecord = {
        timestamp: now,
        cardId: options.cardId,
        url: trackedUrl ?? previousState.url,
        eventType: "exited",
        list: options.fromList,
        label: getPrimaryLabel(previousState.labels) ?? label,
        secondsInList,
        completedDate: null,
      };

      await ensureCsvHeader();
      const metricsPath = getMetricsPath();
      await writeFile(metricsPath, formatMetricsRecord(exitRecord) + "\n", { flag: "a" });
    }
  }

  // Record entry into new list
  const entryRecord: MetricsRecord = {
    timestamp: now,
    cardId: options.cardId,
    url: trackedUrl,
    eventType: "entered",
    list: options.toList,
    label,
    secondsInList: null,
    completedDate: getCompletedDate({ list: options.toList, eventType: "entered", now }),
  };

  await ensureCsvHeader();
  const metricsPath = getMetricsPath();
  await writeFile(metricsPath, formatMetricsRecord(entryRecord) + "\n", { flag: "a" });

  // Update current state
  await writeCardState({
    cardId: options.cardId,
    list: options.toList,
    enteredAt: now,
    labels: options.labels,
    url: trackedUrl,
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
  const trackedUrl = normalizeTrackedUrl(options.url);
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
    url: trackedUrl ?? state.url,
    eventType: "exited",
    list: options.list,
    label: getPrimaryLabel(state.labels),
    secondsInList,
    completedDate: null,
  };

  await ensureCsvHeader();
  const metricsPath = getMetricsPath();
  await writeFile(metricsPath, formatMetricsRecord(record) + "\n", { flag: "a" });
  await deleteCardState(options.cardId);
};

export const readMetrics = async (): Promise<MetricsRecord[]> => {
  const metricsPath = getMetricsPath();
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
  leadTime: number | null;
}> => {
  const metrics = await readMetrics();
  const cardMetrics = metrics.filter((m) => m.cardId === cardId);

  let touchTime = 0;
  let enteredReadyAt: string | null = null;
  let enteredDoingAt: string | null = null;
  let completedAt: string | null = null;

  // Sort by timestamp to process chronologically
  const sorted = cardMetrics.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const metric of sorted) {
    if (metric.eventType === "entered" && metric.list === listNames.ready && !enteredReadyAt) {
      enteredReadyAt = metric.timestamp;
    }
    if (metric.eventType === "entered" && metric.list === listNames.doing) {
      enteredDoingAt = metric.timestamp;
    } else if (metric.eventType === "exited" && metric.list === listNames.doing) {
      if (metric.secondsInList) {
        touchTime += metric.secondsInList;
      }
    } else if (
      ((metric.eventType === "entered" && metric.list === listNames.done) ||
        (metric.eventType === "exited" && metric.list === listNames.done && metric.completedDate)) &&
      !completedAt
    ) {
      completedAt = metric.timestamp;
    }
  }

  const cycleTime = enteredDoingAt && completedAt
    ? Math.floor((new Date(completedAt).getTime() - new Date(enteredDoingAt).getTime()) / 1000)
    : null;
  const leadTime = enteredReadyAt && completedAt
    ? Math.floor((new Date(completedAt).getTime() - new Date(enteredReadyAt).getTime()) / 1000)
    : null;

  const waitTime = cycleTime ? Math.max(0, cycleTime - touchTime) : 0;

  return { touchTime, waitTime, cycleTime, leadTime };
};

export const getThroughput = async (options: {
  startDate: string;
  endDate: string;
  label?: string | null;
}): Promise<number> => {
  const metrics = await readMetrics();
  return metrics.filter((m) => {
    const isDoneCompletion =
      (m.eventType === "entered" && m.list === listNames.done && m.completedDate) ||
      (m.eventType === "exited" && m.list === listNames.done && m.completedDate);
    if (!isDoneCompletion) {
      return false;
    }
    if (options.label && m.label !== options.label) {
      return false;
    }
    return m.completedDate >= options.startDate && m.completedDate <= options.endDate;
  }).length;
};
