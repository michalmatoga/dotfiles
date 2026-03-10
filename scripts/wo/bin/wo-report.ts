#!/usr/bin/env node
import { readMetrics, getThroughput } from "../lib/metrics/lifecycle";
import { loadEnvFile, requireEnv } from "../lib/env";
import {
  NO_CARD_BUCKET,
  NO_LABEL_BUCKET,
  summarizeActivityWatchTime,
} from "../lib/metrics/aw-time";
import type { MetricsRecord } from "../lib/metrics/types";

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

const showHelp = () => {
  console.log(`
Usage: wo-report <command> [options]

Commands:
  summary [days]     Show summary for last N days (default: 7)
  card <id> [days]   Show detailed metrics for a specific card (default: 30 days)
  throughput [days]  Show throughput for last N days (default: 7)
  help               Show this help message

Examples:
  wo-report summary           # Last 7 days
  wo-report summary 30        # Last 30 days
  wo-report card abc123       # Card details (last 30 days)
  wo-report card abc123 90    # Card details (last 90 days)
  wo-report throughput 14     # 2-week throughput
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
