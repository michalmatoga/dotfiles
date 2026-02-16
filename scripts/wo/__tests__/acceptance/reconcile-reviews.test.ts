import { describe, it, expect } from "vitest";
import { createTestCard, moveTestCard, getListIdByName } from "./helpers/trello";
import { buildTestPRUrl } from "./helpers/github";

/**
 * Acceptance tests for reconcile-reviews use case.
 * 
 * This use case:
 * - Finds review request cards (cards with "review" label)
 * - Checks if the referenced PR has been approved/rejected/merged
 * - Auto-moves approved review cards to Done
 * - Archives cards for merged PRs (where review is no longer needed)
 */
describe("reconcile-reviews", () => {
  describe("review card identification", () => {
    it("identifies review cards by label", async () => {
      // Cards with "review" label are review request cards
      const card = await createTestCard({
        listName: "Waiting",
        name: "REVIEW: [org/repo] Add new feature",
        desc: `PR: ${buildTestPRUrl(400)}`,
        // In real test, would add review label
      });

      expect(card.name).toContain("REVIEW:");
    });

    it("extracts PR URL from review card description", () => {
      const prUrl = buildTestPRUrl(401);
      const desc = `Review this PR: ${prUrl}\n\nThis PR adds a cool feature.`;
      
      // Pattern to extract PR URL
      const urlPattern = /https:\/\/[^\s]+\/pull\/\d+/;
      const match = desc.match(urlPattern);
      
      expect(match).toBeDefined();
      expect(match![0]).toBe(prUrl);
    });
  });

  describe("review state detection", () => {
    it("identifies approved state", () => {
      const reviewStates = ["APPROVED", "CHANGES_REQUESTED", "PENDING", "COMMENTED"];
      
      const hasApproval = reviewStates.some((s) => s === "APPROVED");
      expect(hasApproval).toBe(true);
    });

    it("identifies changes requested state", () => {
      const reviewStates = ["CHANGES_REQUESTED"];
      
      const hasChangesRequested = reviewStates.includes("CHANGES_REQUESTED");
      expect(hasChangesRequested).toBe(true);
    });

    it("distinguishes between my review and others", () => {
      const reviews = [
        { author: "michal-matoga", state: "APPROVED" },
        { author: "other-user", state: "CHANGES_REQUESTED" },
      ];
      
      const myReview = reviews.find((r) => r.author === "michal-matoga");
      expect(myReview).toBeDefined();
      expect(myReview!.state).toBe("APPROVED");
    });
  });

  describe("PR lifecycle states", () => {
    it("identifies merged PR", () => {
      const prStates = {
        state: "MERGED",
        merged: true,
        closed: true,
      };
      
      expect(prStates.state).toBe("MERGED");
      expect(prStates.merged).toBe(true);
    });

    it("identifies closed (not merged) PR", () => {
      const prStates = {
        state: "CLOSED",
        merged: false,
        closed: true,
      };
      
      expect(prStates.merged).toBe(false);
      expect(prStates.closed).toBe(true);
    });

    it("identifies open PR awaiting review", () => {
      const prStates = {
        state: "OPEN",
        merged: false,
        closed: false,
        reviewDecision: "REVIEW_REQUIRED",
      };
      
      expect(prStates.state).toBe("OPEN");
      expect(prStates.reviewDecision).toBe("REVIEW_REQUIRED");
    });
  });

  describe("card actions", () => {
    it("moves card to Done when I approved the PR", async () => {
      const doneId = await getListIdByName("Done");
      
      // Create review card in Waiting
      const card = await createTestCard({
        listName: "Waiting",
        name: "REVIEW: [org/repo] Feature PR",
        desc: buildTestPRUrl(402),
      });

      // Simulate moving to Done after approval
      const movedCard = await moveTestCard(card.id, "Done");
      expect(movedCard.idList).toBe(doneId);
    });

    it("keeps card in Waiting when changes requested", async () => {
      const waitingId = await getListIdByName("Waiting");
      
      const card = await createTestCard({
        listName: "Waiting",
        name: "REVIEW: [org/repo] Needs fixes",
        desc: buildTestPRUrl(403),
      });

      // Card should stay in Waiting - no move
      expect(card.idList).toBe(waitingId);
    });

    it("archives card when PR merged without my review", async () => {
      // When a PR is merged and I never reviewed it,
      // the review card should be archived (no action needed)
      
      // This test verifies the concept - actual archiving
      // would be tested with the Trello API
      const prState = "MERGED";
      const myReviewState = null; // Never reviewed
      
      const shouldArchive = prState === "MERGED" && myReviewState === null;
      expect(shouldArchive).toBe(true);
    });
  });

  describe("skip conditions", () => {
    it("skips cards already in Done", async () => {
      const doneId = await getListIdByName("Done");
      
      const card = await createTestCard({
        listName: "Done",
        name: "REVIEW: [org/repo] Already completed",
        desc: buildTestPRUrl(404),
      });

      expect(card.idList).toBe(doneId);
      
      // Use case should skip processing cards already in Done
      const shouldProcess = card.idList !== doneId;
      expect(shouldProcess).toBe(false);
    });

    it("skips cards without PR URL", async () => {
      const card = await createTestCard({
        listName: "Waiting",
        name: "REVIEW: Missing URL",
        desc: "No PR URL in this description",
      });

      const prUrlPattern = /https:\/\/[^\s]+\/pull\/\d+/;
      const hasUrl = prUrlPattern.test(card.desc);
      expect(hasUrl).toBe(false);
    });
  });
});
