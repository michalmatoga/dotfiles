import { buildThroughputChartData, parseTrackedLabels } from "../../lib/metrics/chart-data";
import type { MetricsRecord } from "../../lib/metrics/types";

const toDoneRecord = (overrides: Partial<MetricsRecord>): MetricsRecord => ({
  timestamp: "2026-03-01T10:00:00.000Z",
  cardId: "card-1",
  url: "https://trello.com/c/card-1",
  eventType: "entered",
  list: "Done",
  labels: ["career"],
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
      toDoneRecord({
        cardId: "card-1",
        timestamp: "2026-03-01T10:00:00.000Z",
        labels: ["career"],
        completedDate: "2026-03-01",
      }),
      toDoneRecord({ cardId: "card-1", eventType: "exited", completedDate: "2026-03-01" }),
      toDoneRecord({
        cardId: "card-2",
        timestamp: "2026-03-01T12:00:00.000Z",
        labels: ["review", "career"],
        completedDate: "2026-03-01",
      }),
      toDoneRecord({
        cardId: "card-3",
        timestamp: "2026-03-01T15:00:00.000Z",
        labels: ["career"],
        completedDate: "2026-03-01",
      }),
    ];

    const data = buildThroughputChartData({
      metrics,
      labels: ["career", "review"],
      now: new Date("2026-03-03T23:59:59.000Z"),
    });

    expect(data.startDate).toBe("2026-03-01");
    expect(data.endDate).toBe("2026-03-01");
    expect(data.startAt).toBe("2026-03-01T10:00:00.000Z");
    expect(data.endAt).toBe("2026-03-01T15:00:00.000Z");
    expect(data.totalCompletedCards).toBe(3);
    expect(data.points).toHaveLength(6);

    const careerSeries = data.points.filter((point) => point.label === "career");
    const reviewSeries = data.points.filter((point) => point.label === "review");

    expect(careerSeries.map((point) => point.completed)).toEqual([1, 1, 1]);
    expect(careerSeries.map((point) => point.cumulativeCompleted)).toEqual([1, 2, 3]);
    expect(reviewSeries.map((point) => point.completed)).toEqual([0, 1, 0]);
    expect(reviewSeries.map((point) => point.cumulativeCompleted)).toEqual([0, 1, 1]);
    expect(careerSeries.map((point) => point.at)).toEqual([
      "2026-03-01T10:00:00.000Z",
      "2026-03-01T12:00:00.000Z",
      "2026-03-01T15:00:00.000Z",
    ]);
  });

  it("returns one zeroed day when selected labels have no completions", () => {
    const data = buildThroughputChartData({
      metrics: [],
      labels: ["career", "review"],
      now: new Date("2026-03-07T09:00:00.000Z"),
    });

    expect(data.startDate).toBe("2026-03-07");
    expect(data.endDate).toBe("2026-03-07");
    expect(data.startAt).toBe("2026-03-07T09:00:00.000Z");
    expect(data.endAt).toBe("2026-03-07T09:00:00.000Z");
    expect(data.points).toHaveLength(2);
    expect(data.points.every((point) => point.completed === 0 && point.cumulativeCompleted === 0)).toBe(true);
  });
});
