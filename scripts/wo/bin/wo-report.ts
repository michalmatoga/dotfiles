#!/usr/bin/env node
import { readMetrics, getCardMetrics, getThroughput } from "../lib/metrics/lifecycle";

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

const showSummary = async (days: number) => {
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

  // Get all unique card IDs that had activity
  const activeCards = new Set<string>();
  for (const m of metrics) {
    const mDate = m.timestamp.split("T")[0];
    if (mDate && mDate >= startStr && mDate <= endStr) {
      activeCards.add(m.cardId);
    }
  }

  // Calculate touch time per card
  const cardStats: Array<{
    cardId: string;
    url: string | null;
    touchTime: number;
    waitTime: number;
    cycleTime: number | null;
    completed: boolean;
  }> = [];

  for (const cardId of activeCards) {
    const stats = await getCardMetrics(cardId);
    const cardMetrics = metrics.find((m) => m.cardId === cardId);
    cardStats.push({
      cardId,
      url: cardMetrics?.url ?? null,
      ...stats,
      completed: stats.cycleTime !== null,
    });
  }

  // Aggregate stats
  const completed = cardStats.filter((c) => c.completed);
  const inProgress = cardStats.filter((c) => !c.completed && c.touchTime > 0);

  console.log(`\n📝 In Progress: ${inProgress.length} items`);
  console.log(`✅ Completed: ${completed.length} items`);

  if (completed.length > 0) {
    const avgTouch = completed.reduce((sum, c) => sum + c.touchTime, 0) / completed.length;
    const avgWait = completed.reduce((sum, c) => sum + c.waitTime, 0) / completed.length;
    const avgCycle = completed.reduce((sum, c) => sum + (c.cycleTime ?? 0), 0) / completed.length;

    console.log(`\n⏱️  Averages (completed items):`);
    console.log(`   Touch time: ${formatDuration(avgTouch)}`);
    console.log(`   Wait time:  ${formatDuration(avgWait)}`);
    console.log(`   Cycle time: ${formatDuration(avgCycle)}`);
  }

  // Show top items by touch time
  if (cardStats.length > 0) {
    console.log(`\n🔥 Top items by touch time:`);
    const top = cardStats
      .filter((c) => c.touchTime > 0)
      .sort((a, b) => b.touchTime - a.touchTime)
      .slice(0, 5);

    for (const item of top) {
      const url = item.url ? item.url.replace("https://", "") : item.cardId.slice(0, 8);
      const status = item.completed ? "✅" : "📝";
      console.log(`   ${status} ${formatDuration(item.touchTime)} - ${url}`);
    }
  }
};

const showCardDetails = async (cardId: string) => {
  const metrics = await readMetrics();
  const cardMetrics = metrics.filter((m) => m.cardId === cardId);

  if (cardMetrics.length === 0) {
    console.log(`No metrics found for card: ${cardId}`);
    return;
  }

  console.log(`\n📋 Card: ${cardId}\n`);

  // Show lifecycle
  console.log("Lifecycle:");
  for (const m of cardMetrics.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )) {
    const time = new Date(m.timestamp).toLocaleString();
    if (m.eventType === "entered") {
      console.log(`  → ${time}: Entered ${m.list}`);
    } else {
      console.log(`  ← ${time}: Exited ${m.list} after ${formatDuration(m.secondsInList ?? 0)}`);
    }
  }

  // Show aggregated stats
  const stats = await getCardMetrics(cardId);
  console.log(`\n📊 Aggregated:`);
  console.log(`  Touch time: ${formatDuration(stats.touchTime)}`);
  console.log(`  Wait time:  ${formatDuration(stats.waitTime)}`);
  if (stats.cycleTime) {
    console.log(`  Cycle time: ${formatDuration(stats.cycleTime)}`);
    console.log(`  Efficiency: ${((stats.touchTime / stats.cycleTime) * 100).toFixed(1)}%`);
  } else {
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
  card <id>          Show detailed metrics for a specific card
  throughput [days]  Show throughput for last N days (default: 7)
  help               Show this help message

Examples:
  wo-report summary           # Last 7 days
  wo-report summary 30        # Last 30 days
  wo-report card abc123       # Card details
  wo-report throughput 14     # 2-week throughput
`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0] ?? "summary";

  try {
    switch (command) {
      case "summary": {
        const days = parseInt(args[1] ?? "7", 10);
        await showSummary(days);
        break;
      }
      case "card": {
        const cardId = args[1];
        if (!cardId) {
          console.error("Error: card ID required");
          process.exit(1);
        }
        await showCardDetails(cardId);
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
