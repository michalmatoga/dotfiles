import {
  buildAreaSummaries,
  formatJournalEntry,
  type HourlyBucket,
  type JournalEntry,
  type WorktreeSummary,
} from "../../lib/sessions/journal";

describe("grouped journal formatting", () => {
  it("groups work by area and keeps ambiguous work in unmapped", () => {
    const worktreeSummaries: WorktreeSummary[] = [
      {
        path: "/tmp/acme/widget",
        label: "acme/widget",
        durationSeconds: 3600,
        commitCount: 1,
        areaKey: "business",
        areaTitle: "Business",
        areaStatus: "single",
      },
      {
        path: "/tmp/acme/notes",
        label: "acme/notes",
        durationSeconds: 1800,
        commitCount: 1,
        areaKey: "unmapped",
        areaTitle: "Unmapped",
        areaStatus: "multiple",
      },
    ];

    const hourlyBuckets: HourlyBucket[] = [
      {
        hour: 9,
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T10:00:00.000Z",
        durationSeconds: 3600,
        commits: [
          {
            hash: "abc123",
            message: "Refine business workflow",
            timestamp: new Date("2026-03-10T09:30:00.000Z"),
            worktree: "/tmp/acme/widget",
          },
        ],
        worktrees: new Set(["/tmp/acme/widget"]),
      },
      {
        hour: 10,
        startTime: "2026-03-10T10:00:00.000Z",
        endTime: "2026-03-10T11:00:00.000Z",
        durationSeconds: 1800,
        commits: [
          {
            hash: "def456",
            message: "Investigate mixed area labels",
            timestamp: new Date("2026-03-10T10:15:00.000Z"),
            worktree: "/tmp/acme/notes",
          },
        ],
        worktrees: new Set(["/tmp/acme/notes"]),
      },
    ];

    const summaries = buildAreaSummaries({
      hourlyBuckets,
      worktreeSummaries,
      orderedAreaKeys: ["business", "career", "health", "growth", "household", "relationships"],
    });

    expect(summaries).toEqual([
      expect.objectContaining({
        key: "business",
        title: "Business",
        durationSeconds: 3600,
        commitSubjects: ["Refine business workflow"],
        hasAmbiguousCards: false,
        hasUnlabeledCards: false,
      }),
      expect.objectContaining({
        key: "unmapped",
        title: "Unmapped",
        durationSeconds: 1800,
        commitSubjects: ["Investigate mixed area labels"],
        hasAmbiguousCards: true,
        hasUnlabeledCards: false,
      }),
    ]);
  });

  it("renders a flat area-based journal entry", async () => {
    const entry: JournalEntry = {
      date: "2026-03-10",
      totalSeconds: 5400,
      hourlyBreakdown: [],
      worktreeSummaries: [],
      areaSummaries: [
        {
          key: "business",
          title: "Business",
          durationSeconds: 3600,
          worktreeSummaries: [],
          commitSubjects: ["Refine business workflow"],
          hasAmbiguousCards: false,
          hasUnlabeledCards: false,
        },
        {
          key: "unmapped",
          title: "Unmapped",
          durationSeconds: 1800,
          worktreeSummaries: [],
          commitSubjects: ["Investigate mixed area labels"],
          hasAmbiguousCards: true,
          hasUnlabeledCards: false,
        },
      ],
    };

    const formatted = await formatJournalEntry(entry, {
      generateAreaSummary: async (summary) => {
        if (summary.key === "business") {
          return "Worked mainly on business tooling updates.";
        }
        return "Worked on cards that did not map cleanly to a single LSS area.";
      },
    });

    expect(formatted).toContain("# 2026-03-10");
    expect(formatted).toContain("**Deep work time:** 1h 30m");
    expect(formatted).toContain("## Business\n**Total:** 1h 0m\nWorked mainly on business tooling updates.");
    expect(formatted).toContain(
      "## Unmapped\n**Total:** 30m\nWorked on cards that did not map cleanly to a single LSS area.",
    );
    expect(formatted).not.toContain("###");
  });
});
