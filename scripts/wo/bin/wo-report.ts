#!/usr/bin/env node
import { readCardStates, readMetrics, getThroughput } from "../lib/metrics/lifecycle";
import { loadEnvFile, requireEnv } from "../lib/env";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  NO_CARD_BUCKET,
  NO_LABEL_BUCKET,
  summarizeActivityWatchTime,
} from "../lib/metrics/aw-time";
import type { MetricsRecord } from "../lib/metrics/types";
import {
  burdenRangeIds,
  buildLiveCycleTimeData,
  buildThroughputChartData,
  mergeBurdenSnapshots,
  mergeCycleTimeSnapshots,
  parseTrackedLabels,
  toFiveMinuteBucketIso,
  type BurdenRangeId,
  type BurdenSnapshotPoint,
  type CycleTimeSnapshotPoint,
} from "../lib/metrics/chart-data";
import { buildGoalTrackingData, defaultGoalTrackingSources } from "../lib/metrics/goal-tracking";
import { buildReviewKpiData } from "../lib/metrics/review-kpi";
import { readJsonlEntries } from "../lib/state/jsonl";
import { readLatestSnapshot, type Snapshot } from "../lib/state/snapshots";
import { loadLssAreas } from "../lib/trello/lss-areas";
import { fetchBoardCardsAll } from "../lib/trello/cards";
import { fetchBoardLabels } from "../lib/trello/labels";
import { fetchBoardLists } from "../lib/trello/lists";
import { listAliases, listNames } from "../lib/policy/mapping";

const formatDuration = (seconds: number): string => {
  if (seconds === 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0]!;
};

const buildTimeRange = (days: number): { start: string; end: string } => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
};

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
};

const normalizeCardUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
};

const snapshotIntervalMinutes = 5;
const snapshotWindowHours = 24;

type WoEventEntry = {
  ts?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

const isDoneCompletionMetric = (metric: MetricsRecord): boolean => {
  if (!metric.completedDate) {
    return false;
  }
  if (metric.list !== "Done") {
    return false;
  }
  return metric.eventType === "entered" || metric.eventType === "exited";
};

const buildSyntheticLssCompletionMetrics = (options: {
  metrics: MetricsRecord[];
  events: WoEventEntry[];
  areaLabelByNoteId: Map<string, string>;
}): MetricsRecord[] => {
  const doneCardIds = new Set(options.metrics.filter(isDoneCompletionMetric).map((metric) => metric.cardId));
  const byCardId = new Map<string, MetricsRecord>();

  for (const event of options.events) {
    if (!event || !event.type || !event.ts) {
      continue;
    }
    const payload = event.payload ?? {};
    const checked = payload.checked;
    const isCheckedTransition = event.type === "lss.initiative.checked"
      || (event.type === "lss.checkbox.mirrored" && checked === true);
    if (!isCheckedTransition) {
      continue;
    }

    const cardIdRaw = payload.cardId;
    const cardId = typeof cardIdRaw === "string" && cardIdRaw.trim().length > 0 ? cardIdRaw : null;
    if (!cardId || doneCardIds.has(cardId)) {
      continue;
    }

    const atMs = Date.parse(event.ts);
    if (!Number.isFinite(atMs)) {
      continue;
    }
    const timestamp = new Date(atMs).toISOString();
    const completedDate = timestamp.split("T")[0] ?? null;
    const noteId = typeof payload.noteId === "string" ? payload.noteId : "";
    const areaLabel = options.areaLabelByNoteId.get(noteId) ?? null;
    const cardUrl = typeof payload.cardUrl === "string"
      ? payload.cardUrl
      : typeof payload.trelloUrl === "string"
        ? payload.trelloUrl
        : null;

    const next: MetricsRecord = {
      timestamp,
      cardId,
      url: cardUrl,
      eventType: "entered",
      list: "Done",
      labels: areaLabel ? [areaLabel] : [],
      secondsInList: null,
      completedDate,
    };

    const existing = byCardId.get(cardId);
    if (!existing || Date.parse(next.timestamp) < Date.parse(existing.timestamp)) {
      byCardId.set(cardId, next);
    }
  }

  return Array.from(byCardId.values()).sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
};

const resolveCycleTimeSnapshotPath = (outputPath: string): string =>
  resolve(dirname(outputPath), "wo-cycle-time-snapshots.jsonl");

const resolveBurdenSnapshotPath = (outputPath: string): string =>
  resolve(dirname(outputPath), "wo-burden-snapshots.jsonl");

const resolveWoSnapshotPath = (outputPath: string): string =>
  resolve(dirname(outputPath), "wo-snapshots.jsonl");

const resolveEventsPath = (outputPath: string): string =>
  resolve(dirname(outputPath), "wo-events.jsonl");

const readCycleTimeSnapshots = async (snapshotPath: string): Promise<CycleTimeSnapshotPoint[]> => {
  const entries = await readJsonlEntries<CycleTimeSnapshotPoint>(snapshotPath);
  return entries
    .map((entry) => {
      const atMs = Date.parse(entry.at ?? "");
      const cycle = Number(entry.cumulativeCycleTimeSeconds);
      const unfinishedCards = Number(entry.unfinishedCards);
      if (!Number.isFinite(atMs) || !Number.isFinite(cycle) || !Number.isFinite(unfinishedCards)) {
        return null;
      }
      const cycleByLabel = Object.fromEntries(
        Object.entries(entry.cumulativeCycleTimeSecondsByLabel ?? {})
          .map(([label, value]) => {
            const normalized = label.trim().toLowerCase();
            return [normalized, Math.max(0, Math.floor(Number(value) || 0))] as const;
          })
          .filter(([label]) => label.length > 0),
      );
      const unfinishedByLabel = Object.fromEntries(
        Object.entries(entry.unfinishedCardsByLabel ?? {})
          .map(([label, value]) => {
            const normalized = label.trim().toLowerCase();
            return [normalized, Math.max(0, Math.floor(Number(value) || 0))] as const;
          })
          .filter(([label]) => label.length > 0),
      );
      return {
        at: new Date(atMs).toISOString(),
        cumulativeCycleTimeSeconds: Math.max(0, Math.floor(cycle)),
        unfinishedCards: Math.max(0, Math.floor(unfinishedCards)),
        cumulativeCycleTimeSecondsByLabel: cycleByLabel,
        unfinishedCardsByLabel: unfinishedByLabel,
      };
    })
    .filter((entry): entry is CycleTimeSnapshotPoint => entry !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
};

const readBurdenSnapshots = async (snapshotPath: string): Promise<BurdenSnapshotPoint[]> => {
  const entries = await readJsonlEntries<BurdenSnapshotPoint>(snapshotPath);
  return entries
    .map((entry) => {
      const atMs = Date.parse(entry.at ?? "");
      if (!Number.isFinite(atMs)) {
        return null;
      }

      const trelloOpenByLabel = Object.fromEntries(
        Object.entries(entry.trelloOpenByLabel ?? {})
          .map(([label, value]) => [label.trim().toLowerCase(), Math.max(0, Math.floor(Number(value) || 0))] as const)
          .filter(([label]) => label.length > 0),
      );

      const mdUncheckedByLabelByRange = Object.fromEntries(
        burdenRangeIds.map((rangeId) => {
          const perLabelRaw = entry.mdUncheckedByLabelByRange && typeof entry.mdUncheckedByLabelByRange === "object"
            ? entry.mdUncheckedByLabelByRange[rangeId] ?? {}
            : {};
          const perLabel = Object.fromEntries(
            Object.entries(perLabelRaw ?? {})
              .map(([label, value]) => [label.trim().toLowerCase(), Math.max(0, Math.floor(Number(value) || 0))] as const)
              .filter(([label]) => label.length > 0),
          );
          return [rangeId, perLabel] as const;
        }),
      ) as Record<BurdenRangeId, Record<string, number>>;

      const mdUncheckedTotalByRange = Object.fromEntries(
        burdenRangeIds.map((rangeId) => {
          const perLabel = mdUncheckedByLabelByRange[rangeId] ?? {};
          const total = Object.values(perLabel).reduce((sum, count) => sum + (Number(count) || 0), 0);
          return [rangeId, total] as const;
        }),
      ) as Record<BurdenRangeId, number>;

      const trelloOpenTotal = Object.values(trelloOpenByLabel).reduce((sum, count) => sum + (Number(count) || 0), 0);

      return {
        at: new Date(atMs).toISOString(),
        trelloOpenByLabel,
        trelloOpenTotal,
        mdUncheckedByLabelByRange,
        mdUncheckedTotalByRange,
      };
    })
    .filter((entry): entry is BurdenSnapshotPoint => entry !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
};

const mergeManyBurdenSnapshots = (
  current: BurdenSnapshotPoint[],
  points: BurdenSnapshotPoint[],
): BurdenSnapshotPoint[] => points.reduce((acc, point) => mergeBurdenSnapshots(acc, point), current);

const buildSyntheticBurdenSnapshotsFromWoState = async (options: {
  outputPath: string;
  cutoffMs: number;
  trackedLabels: string[];
  trackedLabelSet: Set<string>;
  labelIdByName: Map<string, string>;
  doneListIds: Set<string>;
}): Promise<BurdenSnapshotPoint[]> => {
  const snapshotPath = resolveWoSnapshotPath(options.outputPath);
  const entries = await readJsonlEntries<Snapshot>(snapshotPath);
  const labelIdByLabel = options.trackedLabels.map((label) => [label, options.labelIdByName.get(label) ?? ""] as const);

  const mdBurdenByLocalDate = new Map<
    string,
    {
      mdUncheckedByLabelByRange: Record<BurdenRangeId, Record<string, number>>;
      mdUncheckedTotalByRange: Record<BurdenRangeId, number>;
    }
  >();

  const rawPoints: BurdenSnapshotPoint[] = [];
  for (const entry of entries) {
      const atMs = Date.parse(entry?.ts ?? "");
      if (!Number.isFinite(atMs) || atMs < options.cutoffMs) {
        continue;
      }
      const trello = entry?.trello;
      if (!trello || typeof trello !== "object") {
        continue;
      }
      const trelloOpenByLabel = Object.fromEntries(options.trackedLabels.map((label) => [label, 0])) as Record<string, number>;
      for (const card of Object.values(trello)) {
        if (!card || typeof card !== "object") {
          continue;
        }
        const listId = typeof card.listId === "string" ? card.listId : "";
        if (!listId || options.doneListIds.has(listId)) {
          continue;
        }
        const cardLabelSet = new Set(Array.isArray(card.labels) ? card.labels : []);
        for (const [label, labelId] of labelIdByLabel) {
          if (!labelId || !cardLabelSet.has(labelId)) {
            continue;
          }
          trelloOpenByLabel[label] = (trelloOpenByLabel[label] ?? 0) + 1;
        }
      }
      const trelloOpenTotal = Object.values(trelloOpenByLabel).reduce((sum, count) => sum + count, 0);

      const atDate = new Date(atMs);
      const localDateKey = toLocalDateKey(atDate);
      if (!mdBurdenByLocalDate.has(localDateKey)) {
        const historicalGoalTracking = await buildGoalTrackingData({
          now: atDate,
          sources: defaultGoalTrackingSources,
          offsetWindow: 0,
        });
        mdBurdenByLocalDate.set(
          localDateKey,
          buildMdUncheckedBurdenFromGoalTracking({
            goalTracking: historicalGoalTracking,
            trackedLabels: options.trackedLabels,
            trackedLabelSet: options.trackedLabelSet,
          }),
        );
      }
      const mdBurden = mdBurdenByLocalDate.get(localDateKey);
      if (!mdBurden) {
        continue;
      }

      rawPoints.push({
        at: toFiveMinuteBucketIso(atDate),
        trelloOpenByLabel,
        trelloOpenTotal,
        mdUncheckedByLabelByRange: mdBurden.mdUncheckedByLabelByRange,
        mdUncheckedTotalByRange: mdBurden.mdUncheckedTotalByRange,
      });
  }

  rawPoints.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (rawPoints.length === 0) {
    return [];
  }

  const byBucket = new Map<string, BurdenSnapshotPoint>();
  for (const point of rawPoints) {
    byBucket.set(point.at, point);
  }

  const dense: BurdenSnapshotPoint[] = [];
  const stepMs = snapshotIntervalMinutes * 60 * 1000;
  const cutoffBucketMs = Date.parse(toFiveMinuteBucketIso(new Date(options.cutoffMs)));
  const nowBucketMs = Date.parse(toFiveMinuteBucketIso(new Date()));
  let lastPoint: BurdenSnapshotPoint | null = null;

  for (let cursor = cutoffBucketMs; cursor <= nowBucketMs; cursor += stepMs) {
    const atIso = new Date(cursor).toISOString();
    const exact = byBucket.get(atIso);
    if (exact) {
      lastPoint = exact;
    }
    if (!lastPoint) {
      continue;
    }
    dense.push({
      at: atIso,
      trelloOpenByLabel: lastPoint.trelloOpenByLabel,
      trelloOpenTotal: lastPoint.trelloOpenTotal,
      mdUncheckedByLabelByRange: lastPoint.mdUncheckedByLabelByRange,
      mdUncheckedTotalByRange: lastPoint.mdUncheckedTotalByRange,
    });
  }

  return dense;
};

const parseOptionValue = (args: string[], optionName: string): string | null => {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1] ?? null;
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
};

const hasOption = (args: string[], optionName: string): boolean => args.includes(optionName);

const normalizeLabelName = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const countUncheckedChecklistItems = (markdown: string): number => {
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return 0;
  }
  const matches = markdown.match(/^\s*[-*]\s+\[(?: )\]\s+/gm) || [];
  return matches.length;
};

const toLocalDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildMdUncheckedBurdenFromGoalTracking = (options: {
  goalTracking: Awaited<ReturnType<typeof buildGoalTrackingData>>;
  trackedLabels: string[];
  trackedLabelSet: Set<string>;
}): {
  mdUncheckedByLabelByRange: Record<BurdenRangeId, Record<string, number>>;
  mdUncheckedTotalByRange: Record<BurdenRangeId, number>;
} => {
  const mdUncheckedByLabelByRange = Object.fromEntries(
    burdenRangeIds.map((rangeId) => [rangeId, Object.fromEntries(options.trackedLabels.map((label) => [label, 0]))]),
  ) as Record<BurdenRangeId, Record<string, number>>;

  for (const source of options.goalTracking.sources) {
    const sourceLabels = (source.labels ?? [])
      .map((label) => normalizeLabelName(label))
      .filter((label) => options.trackedLabelSet.has(label));
    if (sourceLabels.length === 0) {
      continue;
    }
    for (const rangeId of burdenRangeIds) {
      const markdown = source.byRange?.[rangeId]?.markdown ?? "";
      const unchecked = countUncheckedChecklistItems(markdown);
      if (unchecked <= 0) {
        continue;
      }
      for (const label of sourceLabels) {
        mdUncheckedByLabelByRange[rangeId][label] = (mdUncheckedByLabelByRange[rangeId][label] ?? 0) + unchecked;
      }
    }
  }

  const mdUncheckedTotalByRange = Object.fromEntries(
    burdenRangeIds.map((rangeId) => {
      const total = Object.values(mdUncheckedByLabelByRange[rangeId]).reduce((sum, count) => sum + count, 0);
      return [rangeId, total] as const;
    }),
  ) as Record<BurdenRangeId, number>;

  return { mdUncheckedByLabelByRange, mdUncheckedTotalByRange };
};

const toCanonicalListName = (name: string | null | undefined): string => {
  const normalized = typeof name === "string" ? name : "";
  return listAliases[normalized] ?? normalized;
};

const computeLifecycleTimes = (metrics: MetricsRecord[]) => {
  const byCard = new Map<
    string,
    { enteredReadyAt: string | null; enteredDoingAt: string | null; completedAt: string | null }
  >();
  const sorted = [...metrics].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  for (const metric of sorted) {
    const current = byCard.get(metric.cardId) ?? {
      enteredReadyAt: null,
      enteredDoingAt: null,
      completedAt: null,
    };
    if (metric.eventType === "entered" && metric.list === "Ready" && !current.enteredReadyAt) {
      current.enteredReadyAt = metric.timestamp;
    }
    if (metric.eventType === "entered" && metric.list === "Doing") {
      current.enteredDoingAt = metric.timestamp;
    }
    if (
      ((metric.eventType === "entered" && metric.list === "Done") ||
        (metric.eventType === "exited" && metric.list === "Done" && metric.completedDate)) &&
      !current.completedAt
    ) {
      current.completedAt = metric.timestamp;
    }
    byCard.set(metric.cardId, current);
  }
  const cycleTimes = new Map<string, number | null>();
  const leadTimes = new Map<string, number | null>();
  const completionTimes = new Map<string, string | null>();
  for (const [cardId, state] of byCard.entries()) {
    const cycleTime = state.enteredDoingAt && state.completedAt
      ? Math.floor((new Date(state.completedAt).getTime() - new Date(state.enteredDoingAt).getTime()) / 1000)
      : null;
    const leadTime = state.enteredReadyAt && state.completedAt
      ? Math.floor((new Date(state.completedAt).getTime() - new Date(state.enteredReadyAt).getTime()) / 1000)
      : null;
    cycleTimes.set(cardId, cycleTime);
    leadTimes.set(cardId, leadTime);
    completionTimes.set(cardId, state.completedAt);
  }
  return { cycleTimes, leadTimes, completionTimes };
};

const showSummary = async (days: number) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const metrics = await readMetrics();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  console.log(`\n📊 Metrics Summary (${days} days)\n`);

  // Calculate throughput
  const throughput = await getThroughput({ startDate: startStr, endDate: endStr });
  console.log(`✅ Completed: ${throughput} items`);

  const { start, end } = buildTimeRange(days);
  const { totalSeconds, cardTimes, labelTotals, noCardByRepo } = await summarizeActivityWatchTime({
    start,
    end,
    boardId,
  });

  const lifecycle = computeLifecycleTimes(metrics);

  // Calculate active time per card
  const cardStats: Array<{
    cardId: string;
    url: string | null;
    title: string | null;
    activeTime: number;
    waitTime: number;
    cycleTime: number | null;
    leadTime: number | null;
    completed: boolean;
    label: string;
  }> = [];

  for (const entry of cardTimes) {
    const cycleTime = entry.cardId === NO_CARD_BUCKET
      ? null
      : lifecycle.cycleTimes.get(entry.cardId) ?? null;
    const leadTime = entry.cardId === NO_CARD_BUCKET
      ? null
      : lifecycle.leadTimes.get(entry.cardId) ?? null;
    const waitTime = cycleTime ? Math.max(0, cycleTime - entry.durationSeconds) : 0;
    cardStats.push({
      cardId: entry.cardId,
      url: entry.url,
      title: entry.title,
      activeTime: entry.durationSeconds,
      waitTime,
      cycleTime,
      leadTime,
      completed: (lifecycle.completionTimes.get(entry.cardId) ?? null) !== null,
      label: entry.label,
    });
  }

  // Aggregate stats
  const reportable = cardStats.filter((c) => c.cardId !== NO_CARD_BUCKET);
  const completed = reportable.filter((c) => c.completed);
  const inProgress = reportable.filter((c) => !c.completed && c.activeTime > 0);

  console.log(`\n⏱️  Tracked time: ${formatDuration(totalSeconds)}`);

  console.log(`\n📝 In Progress: ${inProgress.length} items`);
  console.log(`✅ Completed: ${completed.length} items`);

  if (completed.length > 0) {
    const avgActive = completed.reduce((sum, c) => sum + c.activeTime, 0) / completed.length;
    const avgWait = completed.reduce((sum, c) => sum + c.waitTime, 0) / completed.length;
    const avgCycle = completed.reduce((sum, c) => sum + (c.cycleTime ?? 0), 0) / completed.length;
    const avgLead = completed.reduce((sum, c) => sum + (c.leadTime ?? 0), 0) / completed.length;

    console.log(`\n⏱️  Averages (completed items):`);
    console.log(`   Active time: ${formatDuration(avgActive)}`);
    console.log(`   Wait time:  ${formatDuration(avgWait)}`);
    console.log(`   Cycle time: ${formatDuration(avgCycle)}`);
    console.log(`   Lead time:  ${formatDuration(avgLead)}`);
  }

  // Show top items by active time
  if (cardStats.length > 0) {
    console.log(`\n🔥 Top items by active time:`);
    const top = cardStats
      .filter((c) => c.activeTime > 0)
      .sort((a, b) => b.activeTime - a.activeTime)
      .slice(0, 5);

    for (const item of top) {
      const labelText = item.label === NO_LABEL_BUCKET ? "" : ` (${item.label})`;
      const name = item.cardId === NO_CARD_BUCKET
        ? NO_CARD_BUCKET
        : item.title
          ? item.title
          : item.url
            ? item.url.replace("https://", "")
            : item.cardId.slice(0, 8);
      const status = item.completed ? "✅" : "📝";
      console.log(`   ${status} ${formatDuration(item.activeTime)} - ${name}${labelText}`);
    }
  }

  if (noCardByRepo.length > 0) {
    console.log(`\n🧭 no-card by repo:`);
    for (const entry of noCardByRepo) {
      console.log(`   ${entry.repo}: ${formatDuration(entry.durationSeconds)}`);
    }
  }

  if (labelTotals.length > 0) {
    console.log(`\n🏷️  Label breakdown:`);
    for (const entry of labelTotals) {
      console.log(`   ${entry.label}: ${formatDuration(entry.durationSeconds)}`);
    }
  }
};

const showCardDetails = async (cardId: string, days: number) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const metrics = await readMetrics();
  const cardMetrics = metrics.filter((m) => m.cardId === cardId);
  const { start, end } = buildTimeRange(days);
  const { cardTimes } = await summarizeActivityWatchTime({ start, end, boardId });
  const cardTime = cardTimes.find((entry) => entry.cardId === cardId);

  if (!cardTime && cardMetrics.length === 0) {
    console.log(`No metrics found for card: ${cardId}`);
    return;
  }

  console.log(`\n📋 Card: ${cardId}\n`);

  if (cardTime) {
    if (cardTime.title) {
      console.log(`Title: ${cardTime.title}`);
    }
    const label = cardTime.label === NO_LABEL_BUCKET ? "no-label" : cardTime.label;
    console.log(`Active time (last ${days} days): ${formatDuration(cardTime.durationSeconds)}`);
    console.log(`Label: ${label}`);
    console.log("");
  }

  // Show lifecycle
  if (cardMetrics.length > 0) {
    console.log("Lifecycle:");
    for (const m of cardMetrics.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )) {
      const time = new Date(m.timestamp).toLocaleString();
      if (m.eventType === "entered") {
        console.log(`  → ${time}: Entered ${m.list}`);
      } else {
        console.log(`  ← ${time}: Exited ${m.list} after ${formatDuration(m.secondsInList ?? 0)}`);
      }
    }
  }

  const lifecycle = computeLifecycleTimes(metrics);
  const cycleTime = lifecycle.cycleTimes.get(cardId) ?? null;
  const leadTime = lifecycle.leadTimes.get(cardId) ?? null;
  if (cycleTime !== null && cardTime) {
    const waitTime = Math.max(0, cycleTime - cardTime.durationSeconds);
    console.log(`\n📊 Aggregated:`);
    console.log(`  Active time: ${formatDuration(cardTime.durationSeconds)}`);
    console.log(`  Wait time:  ${formatDuration(waitTime)}`);
    console.log(`  Cycle time: ${formatDuration(cycleTime)}`);
    if (leadTime !== null) {
      console.log(`  Lead time:  ${formatDuration(leadTime)}`);
    }
    console.log(`  Efficiency: ${((cardTime.durationSeconds / cycleTime) * 100).toFixed(1)}%`);
  } else if (cycleTime !== null) {
    console.log(`\n📊 Aggregated:`);
    console.log(`  Cycle time: ${formatDuration(cycleTime)}`);
    if (leadTime !== null) {
      console.log(`  Lead time:  ${formatDuration(leadTime)}`);
    }
  } else if (leadTime !== null) {
    console.log(`\n📊 Aggregated:`);
    console.log(`  Lead time:  ${formatDuration(leadTime)}`);
  } else {
    console.log(`\n📊 Aggregated:`);
    console.log(`  Cycle time: In progress...`);
  }
};

const showThroughput = async (days: number, label?: string) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  console.log(`\n🚀 Throughput (${days} days${label ? `, label: ${label}` : ""})\n`);

  const throughput = await getThroughput({ startDate: startStr, endDate: endStr, label });
  console.log(`Completed: ${throughput} items`);
  console.log(`Rate: ${(throughput / days).toFixed(2)} items/day`);

  // Break down by week
  if (days >= 7) {
    console.log("\nWeekly breakdown:");
    const weeks = Math.ceil(days / 7);
    for (let i = 0; i < weeks; i++) {
      const weekEnd = new Date(endDate);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      const weekStartStr = formatDate(weekStart);
      const weekEndStr = formatDate(weekEnd);
      const weekThroughput = await getThroughput({
        startDate: weekStartStr,
        endDate: weekEndStr,
        label,
      });

      console.log(`  Week ${weeks - i}: ${weekThroughput} items (${weekStartStr} to ${weekEndStr})`);
    }
  }
};

const writeChartData = async (options: {
  labels: string[];
  outputPath: string;
}) => {
  const now = new Date();
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const metrics = await readMetrics();
  const events = await readJsonlEntries<WoEventEntry>(resolveEventsPath(options.outputPath));
  const lssAreas = await loadLssAreas();
  const areaLabelByNoteId = new Map(lssAreas.map((area) => [area.noteId, area.label]));
  const syntheticLssCompletions = buildSyntheticLssCompletionMetrics({
    metrics,
    events,
    areaLabelByNoteId,
  });
  const metricsWithLssCompletions = syntheticLssCompletions.length > 0
    ? [...metrics, ...syntheticLssCompletions]
    : metrics;
  const cardStates = Array.from((await readCardStates()).values());
  const latestSnapshot = await readLatestSnapshot();
  const worktreeByUrl = latestSnapshot?.worktrees?.byUrl ?? {};
  const activeWorktreeUrlSet = new Set<string>();
  for (const rawUrl of Object.keys(worktreeByUrl)) {
    const normalized = normalizeCardUrl(rawUrl);
    if (normalized) {
      activeWorktreeUrlSet.add(normalized);
    }
  }
  const scopedCardStates = activeWorktreeUrlSet.size > 0
    ? cardStates.filter((state) => {
      const normalized = normalizeCardUrl(state.url);
      return normalized ? activeWorktreeUrlSet.has(normalized) : false;
    })
    : cardStates;
  const snapshotTrelloCards = latestSnapshot?.trello ?? null;
  const snapshotScopedCardStates = snapshotTrelloCards
    ? scopedCardStates.filter((state) => Boolean(snapshotTrelloCards[state.cardId]))
    : scopedCardStates;
  const chartData = buildThroughputChartData({ metrics: metricsWithLssCompletions, labels: options.labels, now });
  const goalTracking = await buildGoalTrackingData({
    now,
    sources: defaultGoalTrackingSources,
    offsetWindow: 16,
  });
  const boardLabels = await fetchBoardLabels(boardId);
  const boardLists = await fetchBoardLists(boardId);
  const boardCards = await fetchBoardCardsAll(boardId);
  const reviewKpi = buildReviewKpiData({ now, events });
  const liveCycleTime = buildLiveCycleTimeData({
    metrics: metricsWithLssCompletions,
    cardStates: snapshotScopedCardStates,
    labels: options.labels,
    now,
  });

  const snapshotPath = resolveCycleTimeSnapshotPath(options.outputPath);
  const cumulativeCycleTimeSecondsByLabel = Object.fromEntries(
    options.labels.map((label) => {
      const normalized = label.trim().toLowerCase();
      const total = liveCycleTime.cards
        .filter((card) => card.labels.includes(normalized))
        .reduce((sum, card) => sum + card.cycleTimeSeconds, 0);
      return [normalized, total] as const;
    }),
  );
  const unfinishedCardsByLabel = Object.fromEntries(
    options.labels.map((label) => {
      const normalized = label.trim().toLowerCase();
      const total = liveCycleTime.cards
        .filter((card) => card.labels.includes(normalized))
        .length;
      return [normalized, total] as const;
    }),
  );
  const snapshotPoint: CycleTimeSnapshotPoint = {
    at: toFiveMinuteBucketIso(now),
    cumulativeCycleTimeSeconds: liveCycleTime.cumulativeCycleTimeSeconds,
    unfinishedCards: liveCycleTime.unfinishedCards,
    cumulativeCycleTimeSecondsByLabel,
    unfinishedCardsByLabel,
  };
  const currentSnapshots = await readCycleTimeSnapshots(snapshotPath);
  const mergedSnapshots = mergeCycleTimeSnapshots(currentSnapshots, snapshotPoint);
  const cutoffMs = now.getTime() - snapshotWindowHours * 60 * 60 * 1000;
  const snapshots = mergedSnapshots.filter((point) => {
    const pointMs = Date.parse(point.at);
    return Number.isFinite(pointMs) && pointMs >= cutoffMs;
  });
  const persistedSnapshots = snapshots.length > 0 ? snapshots : [snapshotPoint];
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(
    snapshotPath,
    `${persistedSnapshots.map((point) => JSON.stringify(point)).join("\n")}\n`,
    "utf8",
  );

  const trackedLabelsFromAreas = lssAreas
    .map((area) => normalizeLabelName(area.label))
    .filter((label) => label.length > 0);
  const trackedLabels = trackedLabelsFromAreas.length > 0
    ? Array.from(new Set(trackedLabelsFromAreas))
    : options.labels.map((label) => normalizeLabelName(label)).filter((label) => label.length > 0);
  const trackedLabelSet = new Set(trackedLabels);
  const labelIdByName = new Map<string, string>();
  for (const label of boardLabels) {
    const normalized = normalizeLabelName(label.name);
    if (!normalized || labelIdByName.has(normalized)) {
      continue;
    }
    labelIdByName.set(normalized, label.id);
  }
  const listNameById = new Map<string, string>();
  for (const list of boardLists) {
    listNameById.set(list.id, toCanonicalListName(list.name));
  }
  const doneListIds = new Set(
    Array.from(listNameById.entries())
      .filter(([, listName]) => listName === listNames.done)
      .map(([listId]) => listId),
  );

  const trelloOpenByLabel = Object.fromEntries(trackedLabels.map((label) => [label, 0])) as Record<string, number>;
  for (const card of boardCards) {
    if (card.closed) {
      continue;
    }
    if (doneListIds.has(card.idList)) {
      continue;
    }
    const cardLabelSet = new Set(Array.isArray(card.idLabels) ? card.idLabels : []);
    for (const label of trackedLabels) {
      const labelId = labelIdByName.get(label);
      if (!labelId || !cardLabelSet.has(labelId)) {
        continue;
      }
      trelloOpenByLabel[label] = (trelloOpenByLabel[label] ?? 0) + 1;
    }
  }
  const trelloOpenTotal = Object.values(trelloOpenByLabel).reduce((sum, count) => sum + count, 0);

  const { mdUncheckedByLabelByRange, mdUncheckedTotalByRange } = buildMdUncheckedBurdenFromGoalTracking({
    goalTracking,
    trackedLabels,
    trackedLabelSet,
  });

  const burdenSnapshotPoint: BurdenSnapshotPoint = {
    at: toFiveMinuteBucketIso(now),
    trelloOpenByLabel,
    trelloOpenTotal,
    mdUncheckedByLabelByRange,
    mdUncheckedTotalByRange,
  };
  const burdenSnapshotPath = resolveBurdenSnapshotPath(options.outputPath);
  const currentBurdenSnapshots = await readBurdenSnapshots(burdenSnapshotPath);
  let burdenSeededSnapshots = currentBurdenSnapshots;
  let syntheticBurdenSeedCount = 0;
  if (currentBurdenSnapshots.length <= 6) {
    const syntheticSnapshots = await buildSyntheticBurdenSnapshotsFromWoState({
      outputPath: options.outputPath,
      cutoffMs,
      trackedLabels,
      trackedLabelSet,
      labelIdByName,
      doneListIds,
    });
    syntheticBurdenSeedCount = syntheticSnapshots.length;
    burdenSeededSnapshots = mergeManyBurdenSnapshots(currentBurdenSnapshots, syntheticSnapshots);
  }
  const mergedBurdenSnapshots = mergeBurdenSnapshots(burdenSeededSnapshots, burdenSnapshotPoint);
  const burdenSnapshots = mergedBurdenSnapshots.filter((point) => {
    const pointMs = Date.parse(point.at);
    return Number.isFinite(pointMs) && pointMs >= cutoffMs;
  });
  const persistedBurdenSnapshots = burdenSnapshots.length > 0 ? burdenSnapshots : [burdenSnapshotPoint];
  await writeFile(
    burdenSnapshotPath,
    `${persistedBurdenSnapshots.map((point) => JSON.stringify(point)).join("\n")}\n`,
    "utf8",
  );

  const output = {
    ...chartData,
    goalTracking,
    reviewKpi,
    cycleTime: {
      generatedAt: liveCycleTime.generatedAt,
      snapshotIntervalMinutes,
      gaugeCumulativeCycleTimeSeconds: liveCycleTime.cumulativeCycleTimeSeconds,
      gaugeUnfinishedCards: liveCycleTime.unfinishedCards,
      cards: liveCycleTime.cards,
      snapshots: persistedSnapshots,
    },
    burden: {
      generatedAt: now.toISOString(),
      snapshotIntervalMinutes,
      labels: trackedLabels,
      snapshots: persistedBurdenSnapshots,
    },
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const labelsText = chartData.labels.length > 0 ? chartData.labels.join(", ") : "(none)";
  console.log(`Wrote chart data: ${options.outputPath}`);
  console.log(`Labels: ${labelsText}`);
  console.log(`Date range: ${chartData.startDate ?? "--"} to ${chartData.endDate ?? "--"}`);
  console.log(`Data points: ${chartData.points.length}`);
  console.log(`Completed cards: ${chartData.totalCompletedCards}`);
  if (activeWorktreeUrlSet.size > 0) {
    console.log(`Cycle scope: ${snapshotScopedCardStates.length} active worktree cards`);
  }
  console.log(`Live unfinished cards: ${liveCycleTime.unfinishedCards}`);
  console.log(`Live cumulative cycle time: ${formatDuration(liveCycleTime.cumulativeCycleTimeSeconds)}`);
  console.log(`Cycle snapshots (last ${snapshotWindowHours}h): ${persistedSnapshots.length}`);
  console.log(`Trello open tasks: ${trelloOpenTotal}`);
  console.log(`MD unchecked tasks (this-week): ${mdUncheckedTotalByRange["this-week"]}`);
  if (syntheticBurdenSeedCount > 0) {
    console.log(`Synthetic burden seeds from wo-snapshots: ${syntheticBurdenSeedCount}`);
  }
  console.log(`Burden snapshots (last ${snapshotWindowHours}h): ${persistedBurdenSnapshots.length}`);
};

const showChartData = async (args: string[]) => {
  const outputPath = resolve(
    parseOptionValue(args, "--output") ?? "scripts/wo/state/wo-throughput-chart.json",
  );
  const labelsOption = parseOptionValue(args, "--labels") ?? process.env.WO_CHART_LABELS;
  let labels = parseTrackedLabels(labelsOption);
  if (!labelsOption) {
    try {
      const boardId = requireEnv("TRELLO_BOARD_ID_WO");
      const boardLabels = await fetchBoardLabels(boardId);
      labels = parseTrackedLabels(
        boardLabels
          .map((label) => label.name)
          .filter((name): name is string => Boolean(name))
          .join(","),
      ).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.warn(
        `Warning: Could not load board labels for chart-data (${String(error)}). Falling back to labels inferred from throughput metrics.`,
      );
    }
  }
  const watchEnabled = hasOption(args, "--watch");
  const watchSecondsRaw = parseOptionValue(args, "--watch");
  const watchSeconds = watchSecondsRaw ? parseInt(watchSecondsRaw, 10) : 30;

  if (watchEnabled) {
    if (!Number.isFinite(watchSeconds) || watchSeconds < 1) {
      throw new Error("--watch must be >= 1 second");
    }
    console.log(`Watching metrics every ${watchSeconds}s (Ctrl+C to stop)...`);
    while (true) {
      await writeChartData({ labels, outputPath });
      await wait(watchSeconds * 1000);
    }
  }

  await writeChartData({ labels, outputPath });
};

const showHelp = () => {
  console.log(`
Usage: wo-report <command> [options]

Commands:
  summary [days]     Show summary for last N days (default: 7)
  card <id> [days]   Show detailed metrics for a specific card (default: 30 days)
  throughput [days]  Show throughput for last N days (default: 7)
  chart-data         Generate chart JSON for website (all time)
  help               Show this help message

Examples:
  wo-report summary           # Last 7 days
  wo-report summary 30        # Last 30 days
  wo-report card abc123       # Card details (last 30 days)
  wo-report card abc123 90    # Card details (last 90 days)
  wo-report throughput 14     # 2-week throughput
  wo-report chart-data        # All current board labels
  wo-report chart-data --watch 30
  wo-report chart-data --labels career,review,business
  wo-report chart-data --labels career,review,business --watch 30
  wo-report chart-data --output scripts/wo/state/wo-throughput-chart.json
`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0] ?? "summary";

  try {
    try {
      await loadEnvFile(".env");
    } catch {
      try {
        await loadEnvFile(".env.local");
      } catch {
        // No env file present; continue with existing environment variables
      }
    }
    switch (command) {
      case "summary": {
        const days = parseInt(args[1] ?? "7", 10);
        await showSummary(days);
        break;
      }
      case "card": {
        const cardId = args[1];
        const days = parseInt(args[2] ?? "30", 10);
        if (!cardId) {
          console.error("Error: card ID required");
          process.exit(1);
        }
        await showCardDetails(cardId, days);
        break;
      }
      case "throughput": {
        const days = parseInt(args[1] ?? "7", 10);
        await showThroughput(days);
        break;
      }
      case "chart-data": {
        await showChartData(args.slice(1));
        break;
      }
      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

main();
