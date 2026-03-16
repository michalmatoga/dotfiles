import { buildHeader, formatDurationCompact, formatMetricBadge } from "../../bin/tmux-wo-sessionizer";

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
});
