#!/usr/bin/env npx tsx
/**
 * ocmc.ts - Test OpenCode models and cache working ones
 * Usage: npx tsx ocmc.ts [cache_file]
 */

import { execSync, spawn } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_FILE =
  process.argv[2] ||
  join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-models");

const TIMEOUT_MS = 30000;

function getModels(): string[] {
  try {
    const output = execSync("opencode models", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch (err) {
    console.error("Failed to fetch models from opencode:", err);
    process.exit(1);
  }
}

function testModel(model: string): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill("SIGKILL");
        resolve(false);
      }
    }, TIMEOUT_MS);

    const proc = spawn("opencode", ["run", "-m", model, "respond with ok"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(code === 0);
      }
    });

    proc.on("error", () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

async function main() {
  const models = getModels();
  const total = models.length;

  console.log(`Testing ${total} models... (this may take a while)`);
  console.log(`Timeout per model: ${TIMEOUT_MS / 1000}s`);
  console.log(`Cache file: ${CACHE_FILE}`);
  console.log("");

  writeFileSync(CACHE_FILE, "");

  let working = 0;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const progress = `[${i + 1}/${total}]`;
    process.stdout.write(`${progress} Testing ${model.padEnd(45)} `);

    const ok = await testModel(model);
    if (ok) {
      appendFileSync(CACHE_FILE, model + "\n");
      working++;
      console.log("OK");
    } else {
      console.log("FAIL");
    }
  }

  console.log("");
  console.log(`Done. Cached ${working}/${total} working models to ${CACHE_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
