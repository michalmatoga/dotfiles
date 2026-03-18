import type { MetricsRecord } from "./types";
import { normalizeMetricLabels } from "./types";

export type ThroughputPoint = {
  at: string;
  label: string;
  completed: number;
  cumulativeCompleted: number;
};

export type ThroughputChartData = {
  generatedAt: string;
  labels: string[];
  startDate: string | null;
  endDate: string | null;
  startAt: string | null;
  endAt: string | null;
  totalCompletedCards: number;
  points: ThroughputPoint[];
};

const doneListName = "Done";
const noLabelBucket = "no-label";

const toDateOnly = (value: Date): string => value.toISOString().split("T")[0] ?? "";

const normalizeLabel = (value: string | null | undefined): string => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : noLabelBucket;
};

const toComparableTime = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const isDoneCompletion = (metric: MetricsRecord): boolean => {
  if (!metric.completedDate) {
    return false;
  }
  if (metric.list !== doneListName) {
    return false;
  }
  return metric.eventType === "entered" || metric.eventType === "exited";
};

export const parseTrackedLabels = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of value.split(",")) {
    const label = normalizeLabel(raw);
    if (label === noLabelBucket || seen.has(label)) {
      continue;
    }
    seen.add(label);
    labels.push(label);
  }
  return labels;
};

export const buildThroughputChartData = (options: {
  metrics: MetricsRecord[];
  labels?: string[];
  now?: Date;
}): ThroughputChartData => {
  const now = options.now ?? new Date();
  const selectedLabels = (options.labels ?? []).map((label) => normalizeLabel(label));
  const selectedLabelSet = new Set(selectedLabels);

  const doneMetrics = [...options.metrics]
    .filter(isDoneCompletion)
    .sort((a, b) => toComparableTime(a.timestamp) - toComparableTime(b.timestamp));

  const firstCompletionByCardId = new Map<string, { at: string; labels: string[] }>();
  for (const metric of doneMetrics) {
    if (firstCompletionByCardId.has(metric.cardId)) {
      continue;
    }
    const atMs = Date.parse(metric.timestamp);
    if (!Number.isFinite(atMs)) {
      continue;
    }
    const completionLabels = normalizeMetricLabels(metric.labels);
    firstCompletionByCardId.set(metric.cardId, {
      at: new Date(atMs).toISOString(),
      labels: completionLabels.length > 0 ? completionLabels : [noLabelBucket],
    });
  }

  const completions = Array.from(firstCompletionByCardId.values()).map((entry) => {
    const labels = selectedLabelSet.size === 0
      ? entry.labels.filter((label) => label !== noLabelBucket)
      : entry.labels.filter((label) => selectedLabelSet.has(label));
    return { at: entry.at, labels };
  }).filter((entry) => entry.labels.length > 0);

  const labels = selectedLabels.length > 0
    ? selectedLabels
    : Array.from(new Set(completions.flatMap((entry) => entry.labels))).sort((a, b) => a.localeCompare(b));

  if (labels.length === 0) {
    return {
      generatedAt: now.toISOString(),
      labels: [],
      startDate: null,
      endDate: null,
      startAt: null,
      endAt: null,
      totalCompletedCards: 0,
      points: [],
    };
  }

  const completionCountByTimestampLabel = new Map<string, number>();
  const timestamps = new Set<string>();
  for (const completion of completions) {
    timestamps.add(completion.at);
    for (const label of completion.labels) {
      const key = `${completion.at}|${label}`;
      completionCountByTimestampLabel.set(key, (completionCountByTimestampLabel.get(key) ?? 0) + 1);
    }
  }
  if (timestamps.size === 0) {
    timestamps.add(now.toISOString());
  }

  const sortedTimestamps = Array.from(timestamps).sort((a, b) => toComparableTime(a) - toComparableTime(b));
  const startAt = sortedTimestamps[0] ?? null;
  const endAt = sortedTimestamps[sortedTimestamps.length - 1] ?? null;
  const startDate = startAt ? toDateOnly(new Date(startAt)) : null;
  const endDate = endAt ? toDateOnly(new Date(endAt)) : null;

  const points: ThroughputPoint[] = [];
  const cumulativeByLabel = new Map<string, number>();
  for (const label of labels) {
    cumulativeByLabel.set(label, 0);
  }
  for (const at of sortedTimestamps) {
    for (const label of labels) {
      const key = `${at}|${label}`;
      const completed = completionCountByTimestampLabel.get(key) ?? 0;
      const cumulative = (cumulativeByLabel.get(label) ?? 0) + completed;
      cumulativeByLabel.set(label, cumulative);
      points.push({ at, label, completed, cumulativeCompleted: cumulative });
    }
  }

  return {
    generatedAt: now.toISOString(),
    labels,
    startDate,
    endDate,
    startAt,
    endAt,
    totalCompletedCards: completions.length,
    points,
  };
};
