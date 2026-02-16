import { describe, it, expect } from "vitest";
import { createTestCard, fetchTestBoardCards, getListIdByName } from "./helpers/trello";
import { buildTestPRUrl } from "./helpers/github";

/**
 * Acceptance tests for sync-review-requests use case.
 * 
 * These tests verify the behavior of syncing GitHub review requests to Trello.
 * They use VCR-style caching - first run hits real backends, subsequent runs use cache.
 * 
 * Based on scenarios from: scripts/wf/features/review-requests.feature
 */
describe("sync-review-requests", () => {
  describe("basic Trello operations", () => {
    it("can create and fetch cards on test board", async () => {
      // Create a test card
      const card = await createTestCard({
        listName: "Inbox",
        name: "Test review request",
        desc: "PR URL: https://example.com/pr/1",
      });

      expect(card).toBeDefined();
      expect(card.id).toBeDefined();
      expect(card.name).toContain("Test review request");

      // Verify card appears on board
      const cards = await fetchTestBoardCards();
      const found = cards.find((c) => c.id === card.id);
      expect(found).toBeDefined();
    });

    it("can identify cards by PR URL in description", async () => {
      const prUrl = buildTestPRUrl(999);

      // Create a card with PR URL in description
      const card = await createTestCard({
        listName: "Waiting",
        name: "REVIEW: [test/repo] Some PR",
        desc: `Review requested: ${prUrl}`,
      });

      // The card we just created should have the URL in its description
      expect(card.desc).toContain(prUrl);
      expect(card.name).toContain("REVIEW:");
    });
  });

  describe("list operations", () => {
    it("can resolve list IDs by name", async () => {
      const doingId = await getListIdByName("Doing");
      const doneId = await getListIdByName("Done");

      expect(doingId).toBeDefined();
      expect(doneId).toBeDefined();
      expect(doingId).not.toBe(doneId);
    });
  });

  // TODO: Add full use-case tests once infrastructure is validated
  // These would test the actual syncReviewRequestsUseCase function
  // 
  // describe("sync behavior", () => {
  //   it("creates Trello card for new review request", async () => {
  //     // This test would need a real pending review request in test repo
  //     // or would rely on cached gh CLI responses
  //   });
  //
  //   it("skips creation when card already exists", async () => { });
  //   it("archives card when PR is merged without review", async () => { });
  // });
});
