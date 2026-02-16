#!/usr/bin/env npx tsx
/**
 * ocm-sort.ts - Sort models with LRU priority
 * Usage: npx tsx ocm-sort.ts <cache_file> <lru_file>
 * Outputs sorted model list with ★ prefix for recent ones
 */

import { readFileSync, existsSync } from "node:fs";

const cacheFile = process.argv[2];
const lruFile = process.argv[3];

if (!cacheFile) {
  console.error("Usage: ocm-sort.ts <cache_file> <lru_file>");
  process.exit(1);
}

// Read cached models
let models: string[] = [];
if (existsSync(cacheFile)) {
  models = readFileSync(cacheFile, "utf-8").trim().split("\n").filter(Boolean);
}

if (models.length === 0) {
  console.error("No models in cache");
  process.exit(1);
}

// Read LRU data
type LRUData = Record<string, string>;
let lru: LRUData = {};
if (lruFile && existsSync(lruFile)) {
  try {
    lru = JSON.parse(readFileSync(lruFile, "utf-8"));
  } catch {
    lru = {};
  }
}

// Sort models: recent first (top 5), then rest
const modelsWithTimestamp = models.map((model) => ({
  model,
  timestamp: lru[model] || "",
}));

const recent = modelsWithTimestamp
  .filter((m) => m.timestamp)
  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  .slice(0, 5);

const recentModels = new Set(recent.map((m) => m.model));
const rest = models.filter((m) => !recentModels.has(m));

// Output: recent with ★ prefix, then rest
for (const { model } of recent) {
  console.log(`★ ${model}`);
}
for (const model of rest) {
  console.log(model);
}
