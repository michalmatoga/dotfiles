#!/usr/bin/env npx tsx
/**
 * ocm-lru.ts - Update LRU file with model selection
 * Usage: npx tsx ocm-lru.ts <lru_file> <model>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const lruFile = process.argv[2];
const model = process.argv[3];

if (!lruFile || !model) {
  console.error("Usage: ocm-lru.ts <lru_file> <model>");
  process.exit(1);
}

type LRUData = Record<string, string>;
let lru: LRUData = {};

if (existsSync(lruFile)) {
  try {
    lru = JSON.parse(readFileSync(lruFile, "utf-8"));
  } catch {
    lru = {};
  }
}

lru[model] = new Date().toISOString();

writeFileSync(lruFile, JSON.stringify(lru, null, 2) + "\n");
