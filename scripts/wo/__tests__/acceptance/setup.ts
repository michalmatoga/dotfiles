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

// Hardcoded test board ID - dedicated board for acceptance tests
// This ensures tests never accidentally hit production, even with NO_CACHE=true
const TEST_BOARD_ID = "699311b922eee0934a5f52cd";

/**
 * Global setup - runs once before all tests.
 */
beforeAll(async () => {
  console.log("[setup] Starting test setup...");

  // Load main .env for Trello credentials
  try {
    await loadEnvFile(path.join(__dirname, "../../../..", ".env"));
  } catch {
    // Ignore - credentials may already be in environment
  }

  // Load test-specific overrides
  try {
    await loadEnvFile(ENV_TEST_PATH, { override: true });
    console.log("[setup] Loaded .env.test");
  } catch {
    // .env.test is optional
  }

  // Always override board ID to test board - this is the critical safety measure
  process.env.TRELLO_BOARD_ID_WO = TEST_BOARD_ID;
  console.log(`[setup] Using test board: ${TEST_BOARD_ID}`);

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
