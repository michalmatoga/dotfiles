import {
  buildPitWallHeader,
  buildHeader,
  formatDurationCompact,
  formatMetricBadge,
  formatPickerLine,
  isReviewCardState,
} from "../../bin/tmux-wo-sessionizer";

describe("tmux wo sessionizer formatting", () => {
  it("formats compact durations", () => {
    expect(formatDurationCompact(59)).toBe("0m");
    expect(formatDurationCompact(90 * 60)).toBe("1h 30m");
    expect(formatDurationCompact(51 * 60 * 60)).toBe("2d 3h");
  });

  it("renders fixed-width metric badges", () => {
    expect(formatMetricBadge({ kind: "cycle", ageSeconds: 51 * 60 * 60 })).toBe("[🛠️  2d 3h ]");
    expect(formatMetricBadge({ kind: "lead", ageSeconds: 7 * 60 * 60 + 15 * 60 })).toBe("[⏳  7h 15m]");
    expect(formatMetricBadge({ kind: "none", ageSeconds: null })).toBe("[·   --    ]");
  });

  it("builds weekend-proof header text", () => {
    const header = buildHeader({
      now: new Date("2026-03-16T12:00:00.000Z"),
      oldestDoingAgeSeconds: 2 * 24 * 60 * 60,
      completedCycles: [
        { completedAt: new Date("2026-03-13T10:00:00.000Z").getTime(), cycleSeconds: 30 * 60 * 60 },
        { completedAt: new Date("2026-03-14T10:00:00.000Z").getTime(), cycleSeconds: 2 * 60 * 60 },
      ],
    });

    expect(header).toContain("🎯 Focus: Oldest Doing = 2d 0h");
    expect(header).toContain("🏆 Best (last 30 workdays): 1d 6h");
  });

  it("ignores sub-minute outliers when computing best cycle", () => {
    const header = buildHeader({
      now: new Date("2026-03-16T12:00:00.000Z"),
      oldestDoingAgeSeconds: null,
      completedCycles: [
        { completedAt: new Date("2026-03-14T10:00:00.000Z").getTime(), cycleSeconds: 2 },
        { completedAt: new Date("2026-03-13T10:00:00.000Z").getTime(), cycleSeconds: 42 * 60 },
      ],
    });

    expect(header).toContain("🏆 Best (last 30 workdays): 42m");
  });

  it("builds pit wall header for selected labels", () => {
    const header = buildPitWallHeader({
      now: new Date("2026-03-16T12:00:00.000Z"),
      labels: ["career", "business", "review", "household"],
      cardStates: [
        {
          cardId: "c-career",
          list: "Doing",
          enteredAt: "2026-03-16T10:00:00.000Z",
          labels: ["career"],
          url: null,
        },
        {
          cardId: "c-review",
          list: "Ready",
          enteredAt: "2026-03-16T11:00:00.000Z",
          labels: ["review", "career"],
          url: null,
        },
        {
          cardId: "c-business",
          list: "Waiting",
          enteredAt: "2026-03-16T09:00:00.000Z",
          labels: ["business"],
          url: null,
        },
      ],
      completedCycles: [
        {
          cardId: "c-career",
          completedAt: new Date("2026-03-15T10:00:00.000Z").getTime(),
          cycleSeconds: 2 * 60 * 60,
          label: "career",
        },
        {
          cardId: "c-review",
          completedAt: new Date("2026-03-15T11:00:00.000Z").getTime(),
          cycleSeconds: 30 * 60,
          label: "review",
        },
        {
          cardId: "c-business",
          completedAt: new Date("2026-03-15T09:00:00.000Z").getTime(),
          cycleSeconds: 4 * 60 * 60,
          label: "business",
        },
      ],
      awSecondsByLabel: new Map([
        ["career", 90 * 60],
        ["business", 30 * 60],
      ]),
    });

    expect(header).toContain("PIT WALL: career | business | review | household");
    expect(header).toContain("career    🏁  2/7d");
    expect(header).toContain("business  🏁  1/7d");
    expect(header).toContain("review    🏁  1/7d");
    expect(header).toContain("household 🏁  0/7d");
    expect(header).toContain("⏱ p70 2h 0m");
    expect(header).toContain("🕒 1h 30m");
    expect(header).toContain("🕒 30m");
    expect(header).toContain("🕒 --");
  });

  it("detects review requests from card labels", () => {
    expect(isReviewCardState({ cardId: "c1", list: "Ready", enteredAt: "now", labels: ["review"], url: null })).toBe(true);
    expect(isReviewCardState({ cardId: "c2", list: "Doing", enteredAt: "now", labels: ["Review"], url: null })).toBe(true);
    expect(isReviewCardState({ cardId: "c3", list: "Ready", enteredAt: "now", labels: ["feature"], url: null })).toBe(false);
    expect(isReviewCardState(undefined)).toBe(false);
  });

  it("renders review rows in purple", () => {
    const plain = formatPickerLine({
      entry: { path: "/tmp/repo", kind: "worktree" },
      category: 1,
      ageSeconds: 120,
      label: "github.com › me › repo › feat",
      badge: "[⏳  2m   ]",
      isReviewRequest: false,
    });
    const review = formatPickerLine({
      entry: { path: "/tmp/review", kind: "worktree" },
      category: 1,
      ageSeconds: 120,
      label: "github.com › me › repo › pr-12",
      badge: "[⏳  2m   ]",
      isReviewRequest: true,
    });

    expect(plain).toBe("[⏳  2m   ] github.com › me › repo › feat\u001f/tmp/repo");
    expect(review).toContain("\u001b[38;5;141m");
    expect(review).toContain("\u001b[0m\u001f/tmp/review");
  });
});
