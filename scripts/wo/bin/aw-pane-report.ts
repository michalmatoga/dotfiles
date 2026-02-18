#!/usr/bin/env node

import { hostname } from "node:os";

import {
  getBucket,
  getEvents,
  getTodayTimeRange,
  aggregateUniqueDuration,
  aggregateUniqueDurationByDataKey,
  aggregateUniqueDurationByDataKeyByHour,
  isServerAvailable,
} from "../lib/sessions/activitywatch";

type PathStats = {
  durationSeconds: number;
  events: number;
  hourly: number[];
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const remMinutes = mins % 60;
  if (hrs > 0) {
    return `${hrs}h ${remMinutes}m`;
  }
  return `${remMinutes}m`;
};

const bucketId = `aw-watcher-tmux_${hostname()}`;

(async function main() {
  if (!(await isServerAvailable())) {
    console.error("ActivityWatch server is unreachable on port 5601. Start aw-server and retry.");
    process.exit(1);
  }

  const bucket = await getBucket(bucketId);
  if (!bucket) {
    console.error(`Bucket '${bucketId}' not found. Make sure aw-watcher-tmux is running.`);
    process.exit(1);
  }

  const { start, end } = getTodayTimeRange();
  const events = await getEvents(bucketId, { start, end, limit: 4000 });

  if (events.length === 0) {
    console.log("No tmux activity recorded for today yet.");
    return;
  }

  const stats = new Map<string, PathStats>();
  const totalSeconds = aggregateUniqueDuration(events);
  const durationByPath = aggregateUniqueDurationByDataKey(events, "pane_path");
  const hourlyByPath = aggregateUniqueDurationByDataKeyByHour(events, "pane_path");
  const eventCounts = new Map<string, number>();

  for (const event of events) {
    const path = String(event.data.pane_path ?? "(unknown)");
    eventCounts.set(path, (eventCounts.get(path) ?? 0) + 1);
  }

  for (const [path, durationSeconds] of durationByPath.entries()) {
    stats.set(path, {
      durationSeconds,
      events: eventCounts.get(path) ?? 0,
      hourly: hourlyByPath.get(path) ?? Array(24).fill(0),
    });
  }

  const sorted = Array.from(stats.entries()).sort((a, b) => b[1].durationSeconds - a[1].durationSeconds);

  console.log(`Today's total tracked tmux time: ${formatDuration(totalSeconds)} (${Math.round(totalSeconds / 60)}m)`);
  console.log("Pane path summary (longest first):");
  for (const [path, data] of sorted) {
    console.log(`\n${path}`);
    console.log(`  Duration: ${formatDuration(data.durationSeconds)} (${data.events} events)`);
    const hourly = data.hourly.map((value) => (value > 0 ? formatDuration(value) : "--")).join(" ");
    console.log(`  Hourly: ${hourly}`);
  }

  console.log("\nTimeline visualization (each ▇ marks an active hour):");
  for (const [path, data] of sorted) {
    const bars = data.hourly.map((value) => (value > 0 ? "▇" : "·")).join("");
    console.log(`${path}\n  ${bars}`);
  }
})();
