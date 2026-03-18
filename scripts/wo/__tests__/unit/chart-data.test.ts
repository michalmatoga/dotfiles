import { buildThroughputChartData, parseTrackedLabels } from "../../lib/metrics/chart-data";
import type { MetricsRecord } from "../../lib/metrics/types";

const toDoneRecord = (overrides: Partial<MetricsRecord>): MetricsRecord => ({
  timestamp: "2026-03-01T10:00:00.000Z",
  cardId: "card-1",
  url: "https://trello.com/c/card-1",
  eventType: "entered",
  list: "Done",
  label: "career",
  secondsInList: null,
  completedDate: "2026-03-01",
  ...overrides,
});

describe("parseTrackedLabels", () => {
  it("normalizes, deduplicates, and skips empty labels", () => {
    expect(parseTrackedLabels(" Career,review,career, ,business ")).toEqual([
      "career",
      "review",
      "business",
    ]);
  });
});

describe("buildThroughputChartData", () => {
  it("builds cumulative series per label over all dates", () => {
    const metrics: MetricsRecord[] = [
      toDoneRecord({ cardId: "card-1", label: "career", completedDate: "2026-03-01" }),
      toDoneRecord({ cardId: "card-1", eventType: "exited", completedDate: "2026-03-01" }),
      toDoneRecord({ cardId: "card-2", label: "review", completedDate: "2026-03-02" }),
      toDoneRecord({ cardId: "card-3", label: "career", completedDate: "2026-03-03" }),
    ];

    const data = buildThroughputChartData({
      metrics,
      labels: ["career", "review"],
      now: new Date("2026-03-03T23:59:59.000Z"),
    });

    expect(data.startDate).toBe("2026-03-01");
    expect(data.endDate).toBe("2026-03-03");
    expect(data.totalCompletedCards).toBe(3);
    expect(data.points).toHaveLength(6);

    const careerSeries = data.points.filter((point) => point.label === "career");
    const reviewSeries = data.points.filter((point) => point.label === "review");

    expect(careerSeries.map((point) => point.completed)).toEqual([1, 0, 1]);
    expect(careerSeries.map((point) => point.cumulativeCompleted)).toEqual([1, 1, 2]);
    expect(reviewSeries.map((point) => point.completed)).toEqual([0, 1, 0]);
    expect(reviewSeries.map((point) => point.cumulativeCompleted)).toEqual([0, 1, 1]);
  });

  it("returns one zeroed day when selected labels have no completions", () => {
    const data = buildThroughputChartData({
      metrics: [],
      labels: ["career", "review"],
      now: new Date("2026-03-07T09:00:00.000Z"),
    });

    expect(data.startDate).toBe("2026-03-07");
    expect(data.endDate).toBe("2026-03-07");
    expect(data.points).toHaveLength(2);
    expect(data.points.every((point) => point.completed === 0 && point.cumulativeCompleted === 0)).toBe(true);
  });
});
