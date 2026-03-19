import type { CardListState, MetricsRecord } from "./types";
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

export type LiveCycleTimeCard = {
  cardId: string;
  url: string | null;
  labels: string[];
  enteredDoingAt: string;
  cycleTimeSeconds: number;
};

export type LiveCycleTimeData = {
  generatedAt: string;
  cumulativeCycleTimeSeconds: number;
  unfinishedCards: number;
  cards: LiveCycleTimeCard[];
};

export type CycleTimeSnapshotPoint = {
  at: string;
  cumulativeCycleTimeSeconds: number;
  unfinishedCards: number;
  cumulativeCycleTimeSecondsByLabel?: Record<string, number>;
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

const isDoingEntry = (metric: MetricsRecord): boolean =>
  metric.eventType === "entered" && metric.list === "Doing";

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

export const toFiveMinuteBucketIso = (value: Date): string => {
  const rounded = new Date(value);
  rounded.setUTCSeconds(0, 0);
  const minutes = rounded.getUTCMinutes();
  rounded.setUTCMinutes(minutes - (minutes % 5));
  return rounded.toISOString();
};

export const mergeCycleTimeSnapshots = (
  current: CycleTimeSnapshotPoint[],
  nextPoint: CycleTimeSnapshotPoint,
): CycleTimeSnapshotPoint[] => {
  const normalized = [...current]
    .filter((point) => point && point.at)
    .map((point) => ({
      at: new Date(point.at).toISOString(),
      cumulativeCycleTimeSeconds: Number(point.cumulativeCycleTimeSeconds) || 0,
      unfinishedCards: Number(point.unfinishedCards) || 0,
      cumulativeCycleTimeSecondsByLabel: Object.fromEntries(
        Object.entries(point.cumulativeCycleTimeSecondsByLabel ?? {})
          .map(([label, value]) => [normalizeLabel(label), Number(value) || 0])
          .filter(([label]) => label !== noLabelBucket),
      ),
    }));

  const byTimestamp = new Map<string, CycleTimeSnapshotPoint>();
  for (const point of normalized) {
    byTimestamp.set(point.at, point);
  }
  byTimestamp.set(nextPoint.at, nextPoint);

  return Array.from(byTimestamp.values()).sort(
    (a, b) => toComparableTime(a.at) - toComparableTime(b.at),
  );
};

export const buildLiveCycleTimeData = (options: {
  metrics: MetricsRecord[];
  cardStates?: CardListState[];
  labels?: string[];
  now?: Date;
}): LiveCycleTimeData => {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const selectedLabels = (options.labels ?? []).map((label) => normalizeLabel(label));
  const selectedLabelSet = new Set(selectedLabels);

  const sorted = [...options.metrics].sort(
    (a, b) => toComparableTime(a.timestamp) - toComparableTime(b.timestamp),
  );

  const byCard = new Map<string, {
    enteredDoingAt: string | null;
    completedAt: string | null;
    labels: string[];
    url: string | null;
  }>();

  for (const metric of sorted) {
    const current = byCard.get(metric.cardId) ?? {
      enteredDoingAt: null,
      completedAt: null,
      labels: [] as string[],
      url: null as string | null,
    };

    if (isDoingEntry(metric)) {
      current.enteredDoingAt = metric.timestamp;
      current.labels = normalizeMetricLabels(metric.labels);
      current.url = metric.url;
    }

    if (isDoneCompletion(metric) && !current.completedAt) {
      current.completedAt = metric.timestamp;
    }

    byCard.set(metric.cardId, current);
  }

  const cards: LiveCycleTimeCard[] = [];
  let cumulativeCycleTimeSeconds = 0;

  const addCard = (card: {
    cardId: string;
    enteredDoingAt: string;
    labels: string[];
    url: string | null;
  }) => {
    if (selectedLabelSet.size > 0 && !card.labels.some((label) => selectedLabelSet.has(label))) {
      return;
    }
    const enteredMs = Date.parse(card.enteredDoingAt);
    if (!Number.isFinite(enteredMs)) {
      return;
    }
    const cycleTimeSeconds = Math.max(0, Math.floor((nowMs - enteredMs) / 1000));
    cumulativeCycleTimeSeconds += cycleTimeSeconds;
    cards.push({
      cardId: card.cardId,
      url: card.url,
      labels: card.labels,
      enteredDoingAt: new Date(enteredMs).toISOString(),
      cycleTimeSeconds,
    });
  };

  const currentCardStates = Array.isArray(options.cardStates) ? options.cardStates : [];
  if (currentCardStates.length > 0) {
    for (const cardState of currentCardStates) {
      if (!cardState || cardState.list !== "Doing") {
        continue;
      }
      const fromMetrics = byCard.get(cardState.cardId);
      addCard({
        cardId: cardState.cardId,
        enteredDoingAt: cardState.enteredAt,
        labels: normalizeMetricLabels(cardState.labels),
        url: cardState.url ?? fromMetrics?.url ?? null,
      });
    }
  } else {
    for (const [cardId, state] of byCard.entries()) {
      if (!state.enteredDoingAt || state.completedAt) {
        continue;
      }
      addCard({
        cardId,
        enteredDoingAt: state.enteredDoingAt,
        labels: state.labels,
        url: state.url,
      });
    }
  }

  cards.sort((a, b) => b.cycleTimeSeconds - a.cycleTimeSeconds);

  return {
    generatedAt: now.toISOString(),
    cumulativeCycleTimeSeconds,
    unfinishedCards: cards.length,
    cards,
  };
};
