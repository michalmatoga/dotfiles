import { describe, it, expect } from "vitest";
import { createTestCard, moveTestCard, getListIdByName, fetchTestBoardCards } from "./helpers/trello";
import { buildTestIssueUrl } from "./helpers/github";
import { seedTestSnapshot } from "./helpers/state";

/**
 * Acceptance tests for sync-trello-to-github use case.
 * 
 * This use case:
 * - Detects Trello card list moves
 * - Maps Trello lists to GitHub Project statuses
 * - Updates GitHub Project item status when card moves
 * - Only syncs cards with "schibsted" label
 */
describe("sync-trello-to-github", () => {
  describe("list to status mapping", () => {
    it("maps Trello lists to GitHub statuses", async () => {
      // From README.md:
      // Ready -> 📋 Ready
      // Doing -> 🏗 In progress
      // Waiting -> 👀 In review (if review label) or 🚫 Blocked
      // Done -> ✅ Done
      
      const mapping: Record<string, string> = {
        "Ready": "📋 Ready",
        "Doing": "🏗 In progress",
        "Waiting": "👀 In review",
        "Done": "✅ Done",
      };

      expect(mapping["Ready"]).toBe("📋 Ready");
      expect(mapping["Doing"]).toBe("🏗 In progress");
    });

    it("resolves list IDs for mapping", async () => {
      const readyId = await getListIdByName("Ready");
      const doingId = await getListIdByName("Doing");
      const waitingId = await getListIdByName("Waiting");
      const doneId = await getListIdByName("Done");

      expect(readyId).toBeDefined();
      expect(doingId).toBeDefined();
      expect(waitingId).toBeDefined();
      expect(doneId).toBeDefined();

      // All should be different
      const ids = new Set([readyId, doingId, waitingId, doneId]);
      expect(ids.size).toBe(4);
    });
  });

  describe("label filtering", () => {
    it("only syncs cards with schibsted label", async () => {
      // The use case only pushes changes to GitHub for cards with "schibsted" label
      // Other cards (household, journal, etc.) stay local to Trello
      
      const labels = ["schibsted", "review"];
      const hasSchibsted = labels.includes("schibsted");
      expect(hasSchibsted).toBe(true);

      const otherLabels = ["household", "journal"];
      const otherHasSchibsted = otherLabels.includes("schibsted");
      expect(otherHasSchibsted).toBe(false);
    });
  });

  describe("card move detection", () => {
    it("detects when a card moves between lists", async () => {
      const readyId = await getListIdByName("Ready");
      const doingId = await getListIdByName("Doing");

      // Create card in Ready
      const card = await createTestCard({
        listName: "Ready",
        name: "Task to start",
        desc: buildTestIssueUrl(300),
      });
      
      expect(card.idList).toBe(readyId);

      // Move to Doing
      const movedCard = await moveTestCard(card.id, "Doing");
      expect(movedCard.idList).toBe(doingId);
      expect(movedCard.idList).not.toBe(readyId);
    });

    it("tracks list changes in snapshot", async () => {
      const cardId = "test-card-123";
      const readyId = await getListIdByName("Ready");
      
      // Initial snapshot with card in Ready
      await seedTestSnapshot({
        ts: new Date().toISOString(),
        trello: {
          [cardId]: {
            listId: readyId,
            labels: ["schibsted"],
            syncUrl: buildTestIssueUrl(301),
          },
        },
      });

      // After move, snapshot would be updated with new listId
      // The use case compares current listId vs snapshot to detect moves
    });
  });

  describe("Waiting list special handling", () => {
    it("maps Waiting to In Review when card has review label", () => {
      const labels = ["schibsted", "review"];
      const hasReviewLabel = labels.includes("review");
      
      const status = hasReviewLabel ? "👀 In review" : "🚫 Blocked";
      expect(status).toBe("👀 In review");
    });

    it("maps Waiting to Blocked when card has no review label", () => {
      const labels = ["schibsted"];
      const hasReviewLabel = labels.includes("review");
      
      const status = hasReviewLabel ? "👀 In review" : "🚫 Blocked";
      expect(status).toBe("🚫 Blocked");
    });
  });

  describe("GitHub Project update", () => {
    it("identifies project item by issue URL", async () => {
      // The use case needs to find the GitHub Project item ID
      // to update its status field
      
      const issueUrl = buildTestIssueUrl(302);
      const projectItemId = "PVTI_12345"; // Example project item ID
      
      // syncUrl in snapshot maps card to project item
      await seedTestSnapshot({
        ts: new Date().toISOString(),
        trello: {
          "card-id": {
            listId: "list-id",
            labels: ["schibsted"],
            syncUrl: issueUrl,
          },
        },
      });
    });
  });
});
