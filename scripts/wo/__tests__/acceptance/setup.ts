import { vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

// Mock the command module BEFORE any imports that use it
// This must be hoisted to module level
vi.mock("../../lib/command", async () => {
  const { cachedRunCommandCapture, mockRunCommand } = await import("./cache/cli");
  return {
    runCommandCapture: cachedRunCommandCapture,
    runCommand: mockRunCommand,
  };
});

import { initializeCache } from "./cache/index";
import { startHttpCache, stopHttpCache, resetHttpCache } from "./cache/http";
import { resetCliCache } from "./cache/cli";
import { clearStateFiles } from "./helpers/state";
import { cleanupTestCards } from "./helpers/trello";
import { cleanupTestIssues } from "./helpers/github";
import { loadEnvFile } from "../../lib/env";

// Path to test environment file
const ENV_TEST_PATH = path.join(__dirname, ".env.test");

/**
 * Global setup - runs once before all tests.
 */
beforeAll(async () => {
  console.log("[setup] Starting test setup...");

  // Load test environment variables
  try {
    await loadEnvFile(ENV_TEST_PATH);
    console.log("[setup] Loaded .env.test");
  } catch (error) {
    console.warn(`[setup] Could not load ${ENV_TEST_PATH}: ${error}`);
    console.warn("[setup] Make sure .env.test exists with test backend credentials");
  }

  // Initialize cache directories (clears if --no-cache)
  initializeCache();
  console.log("[setup] Cache initialized");

  // Start MSW server for HTTP interception
  startHttpCache();
  console.log("[setup] MSW server started");
  console.log("[setup] CLI commands mocked");
});

/**
 * Global teardown - runs once after all tests.
 */
afterAll(() => {
  console.log("[teardown] Stopping MSW server...");
  stopHttpCache();
});

/**
 * Per-test setup - runs before each test.
 */
beforeEach(async () => {
  // Clear state files for test isolation
  await clearStateFiles();
});

/**
 * Per-test teardown - runs after each test.
 */
afterEach(async () => {
  // Clean up ephemeral test data
  try {
    await cleanupTestCards();
  } catch (error) {
    console.warn("[teardown] Failed to cleanup test cards:", error);
  }

  try {
    await cleanupTestIssues();
  } catch (error) {
    console.warn("[teardown] Failed to cleanup test issues:", error);
  }

  // Reset HTTP handlers (in case test added custom handlers)
  resetHttpCache();

  // Reset CLI mocks
  resetCliCache();
});
