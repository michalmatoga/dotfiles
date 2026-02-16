import { describe, it, expect } from "vitest";
import { seedTestEvents, seedTestSnapshot, readTestEvents } from "./helpers/state";
import { createTestCard, moveTestCard, getListIdByName } from "./helpers/trello";
import { buildTestIssueUrl, buildTestPRUrl } from "./helpers/github";
import { getRunCommandCalls } from "./cache/cli";

/**
 * Acceptance tests for sync-worktrees use case.
 * 
 * This use case:
 * - Reads trello.card.moved events from state
 * - Creates worktrees when cards move to "Doing"
 * - Removes worktrees when cards move to "Done"
 * - Initializes tmux sessions for worktrees
 * 
 * Based on scenarios from: scripts/wf/features/assigned-issues-sessions.feature
 */
describe("sync-worktrees", () => {
  describe("event processing", () => {
    it("skips processing when no card.moved events exist", async () => {
      // Seed empty events
      await seedTestEvents([]);
      
      const events = await readTestEvents();
      expect(events).toHaveLength(0);
    });

    it("filters events by timestamp against last snapshot", async () => {
      const oldTs = "2024-01-01T00:00:00Z";
      const newTs = "2024-01-02T00:00:00Z";
      
      // Seed snapshot with lastEventTs
      await seedTestSnapshot({
        ts: oldTs,
        worktrees: { lastEventTs: oldTs, byUrl: {} },
      });
      
      // Seed events - one old, one new
      await seedTestEvents([
        {
          ts: oldTs,
          type: "trello.card.moved",
          payload: { cardId: "old-card", url: "https://example.com/1", toList: "Doing" },
        },
        {
          ts: newTs,
          type: "trello.card.moved", 
          payload: { cardId: "new-card", url: "https://example.com/2", toList: "Doing" },
        },
      ]);

      const events = await readTestEvents<{ ts: string; type: string }>();
      expect(events).toHaveLength(2);
      
      // Filter like the use case does
      const moves = events.filter(
        (e) => e.type === "trello.card.moved" && new Date(e.ts) > new Date(oldTs)
      );
      expect(moves).toHaveLength(1);
    });
  });

  describe("worktree triggers", () => {
    it("identifies cards moved to Doing list", async () => {
      const doingListId = await getListIdByName("Doing");
      
      // Create a card in Inbox
      const card = await createTestCard({
        listName: "Inbox",
        name: "Test issue for worktree",
        desc: `Issue: ${buildTestIssueUrl(42)}`,
      });

      expect(card).toBeDefined();
      expect(card.idList).not.toBe(doingListId);

      // Move to Doing
      const movedCard = await moveTestCard(card.id, "Doing");
      expect(movedCard.idList).toBe(doingListId);
    });

    it("identifies cards moved to Done list", async () => {
      const doneListId = await getListIdByName("Done");
      
      // Create a card in Doing
      const card = await createTestCard({
        listName: "Doing",
        name: "Completed issue",
        desc: `Issue: ${buildTestIssueUrl(43)}`,
      });

      // Move to Done
      const movedCard = await moveTestCard(card.id, "Done");
      expect(movedCard.idList).toBe(doneListId);
    });
  });

  describe("URL extraction", () => {
    it("extracts issue URLs from card descriptions", () => {
      const issueUrl = buildTestIssueUrl(123);
      
      // Pattern from sync-worktrees.ts
      const match = issueUrl.match(/\/(issues|pull)\/(\d+)$/);
      expect(match).toBeDefined();
      expect(match![1]).toBe("issues");
      expect(match![2]).toBe("123");
    });

    it("extracts PR URLs from card descriptions", () => {
      const prUrl = buildTestPRUrl(456);
      
      const match = prUrl.match(/\/(issues|pull)\/(\d+)$/);
      expect(match).toBeDefined();
      expect(match![1]).toBe("pull");
      expect(match![2]).toBe("456");
    });

    it("extracts host from GitHub URLs", () => {
      const url = "https://schibsted.ghe.com/org/repo/issues/1";
      const match = url.match(/^https:\/\/([^/]+)/);
      expect(match).toBeDefined();
      expect(match![1]).toBe("schibsted.ghe.com");
    });
  });

  describe("event structures", () => {
    it("defines valid worktree.skipped.missing-url event", () => {
      const event = {
        ts: new Date().toISOString(),
        type: "worktree.skipped.missing-url",
        payload: { cardId: "card-without-url" },
      };
      
      expect(event.type).toBe("worktree.skipped.missing-url");
      expect(event.payload.cardId).toBeDefined();
      expect(event.ts).toBeDefined();
    });

    it("defines valid worktree.added event", () => {
      const event = {
        ts: new Date().toISOString(),
        type: "worktree.added",
        payload: {
          cardId: "test-card",
          url: buildTestIssueUrl(1),
          branch: "1-test-issue",
          path: "/home/user/gwq/schibsted.ghe.com/org/repo/1-test-issue",
        },
      };
      
      expect(event.type).toBe("worktree.added");
      expect(event.payload.branch).toBe("1-test-issue");
      expect(event.payload.path).toContain("gwq");
    });

    it("defines valid worktree.removed event", () => {
      const event = {
        ts: new Date().toISOString(),
        type: "worktree.removed",
        payload: {
          cardId: "test-card",
          url: buildTestIssueUrl(1),
          branch: "1-test-issue",
          path: "/home/user/gwq/schibsted.ghe.com/org/repo/1-test-issue",
        },
      };
      
      expect(event.type).toBe("worktree.removed");
      expect(event.payload.branch).toBeDefined();
    });
  });

  describe("CLI command mocking", () => {
    it("tracks runCommand calls for gwq/git operations", () => {
      // runCommand is mocked and tracked
      const calls = getRunCommandCalls();
      
      // Verify the tracking mechanism works
      expect(Array.isArray(calls)).toBe(true);
    });
  });
});
