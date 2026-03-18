import type { MetricsRecord } from "./types";

export type ThroughputPoint = {
  date: string;
  label: string;
  completed: number;
  cumulativeCompleted: number;
};

export type ThroughputChartData = {
  generatedAt: string;
  labels: string[];
  startDate: string | null;
  endDate: string | null;
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

const buildDateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toDateOnly(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
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

  const firstCompletionByCardId = new Map<string, { date: string; label: string }>();
  for (const metric of doneMetrics) {
    if (firstCompletionByCardId.has(metric.cardId)) {
      continue;
    }
    const date = metric.completedDate;
    if (!date) {
      continue;
    }
    firstCompletionByCardId.set(metric.cardId, {
      date,
      label: normalizeLabel(metric.label),
    });
  }

  const completions = Array.from(firstCompletionByCardId.values()).filter((entry) => {
    if (selectedLabelSet.size === 0) {
      return entry.label !== noLabelBucket;
    }
    return selectedLabelSet.has(entry.label);
  });

  const labels = selectedLabels.length > 0
    ? selectedLabels
    : Array.from(new Set(completions.map((entry) => entry.label))).sort((a, b) => a.localeCompare(b));

  if (labels.length === 0) {
    return {
      generatedAt: now.toISOString(),
      labels: [],
      startDate: null,
      endDate: null,
      totalCompletedCards: 0,
      points: [],
    };
  }

  const earliestCompletionDate = completions
    .map((entry) => entry.date)
    .sort((a, b) => a.localeCompare(b))[0] ?? toDateOnly(now);
  const endDate = toDateOnly(now);
  const startDate = earliestCompletionDate;

  const completionCountByDayLabel = new Map<string, number>();
  for (const completion of completions) {
    const key = `${completion.date}|${completion.label}`;
    completionCountByDayLabel.set(key, (completionCountByDayLabel.get(key) ?? 0) + 1);
  }

  const points: ThroughputPoint[] = [];
  const cumulativeByLabel = new Map<string, number>();
  for (const label of labels) {
    cumulativeByLabel.set(label, 0);
  }
  for (const date of buildDateRange(startDate, endDate)) {
    for (const label of labels) {
      const key = `${date}|${label}`;
      const completed = completionCountByDayLabel.get(key) ?? 0;
      const cumulative = (cumulativeByLabel.get(label) ?? 0) + completed;
      cumulativeByLabel.set(label, cumulative);
      points.push({ date, label, completed, cumulativeCompleted: cumulative });
    }
  }

  return {
    generatedAt: now.toISOString(),
    labels,
    startDate,
    endDate,
    totalCompletedCards: completions.length,
    points,
  };
};
