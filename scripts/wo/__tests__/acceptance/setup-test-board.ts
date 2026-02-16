/**
 * One-time setup script to create a test Trello board for acceptance tests.
 * 
 * Usage:
 *   npx tsx scripts/wo/__tests__/acceptance/setup-test-board.ts
 * 
 * This will:
 *   1. Create a new board named "wo-test" in the same workspace as production
 *   2. Set up lists (Inbox, Triage, Ready, Doing, Waiting, Done)
 *   3. Set up labels (schibsted, review, household, etc.)
 *   4. Print the board ID to add to .env.test
 */

import * as path from "node:path";
import { loadEnvFile } from "../../lib/env";
import { createBoard, fetchBoardByShortLink } from "../../lib/trello/boards";
import { loadBoardContext } from "../../lib/trello/context";

// Repo root relative to this file
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const main = async () => {
  // Load production env to get Trello credentials
  await loadEnvFile(path.join(REPO_ROOT, ".env"));

  // Get workspace from existing production board
  const existingBoardShortLink = "HZ7hcWZy"; // Production LSS board
  console.log(`Fetching workspace from production board ${existingBoardShortLink}...`);
  
  const existing = await fetchBoardByShortLink(existingBoardShortLink);
  const organizationId = existing.idOrganization ?? undefined;

  // Create test board
  console.log("Creating test board 'wo-test'...");
  const board = await createBoard({
    name: "wo-test",
    idOrganization: organizationId,
    permissionLevel: "org",
  });

  // Set up lists and labels
  console.log("Setting up lists and labels...");
  await loadBoardContext({ boardId: board.id, allowCreate: true });

  console.log("\n✓ Test board created successfully!");
  console.log(`  Board: ${board.name}`);
  console.log(`  ID: ${board.id}`);
  if (board.url) {
    console.log(`  URL: ${board.url}`);
  }
  console.log("\nAdd this to your .env.test:");
  console.log(`  TRELLO_BOARD_ID_WO=${board.id}`);
};

main().catch((error) => {
  console.error("Failed to create test board:", error);
  process.exit(1);
});
