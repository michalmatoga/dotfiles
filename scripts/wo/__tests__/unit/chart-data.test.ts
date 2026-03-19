import {
  buildLiveCycleTimeData,
  buildThroughputChartData,
  mergeCycleTimeSnapshots,
  parseTrackedLabels,
  toFiveMinuteBucketIso,
} from "../../lib/metrics/chart-data";
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

  it("keeps selected labels with zero throughput in the series", () => {
    const data = buildThroughputChartData({
      metrics: [
        toDoneRecord({
          cardId: "card-1",
          timestamp: "2026-03-01T10:00:00.000Z",
          labels: ["career"],
          completedDate: "2026-03-01",
        }),
      ],
      labels: ["career", "review", "household"],
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(data.labels).toEqual(["career", "review", "household"]);
    expect(data.points).toHaveLength(3);
    const householdSeries = data.points.filter((point) => point.label === "household");
    expect(householdSeries).toEqual([
      {
        at: "2026-03-01T10:00:00.000Z",
        label: "household",
        completed: 0,
        cumulativeCompleted: 0,
      },
    ]);
  });
});

describe("buildLiveCycleTimeData", () => {
  it("sums live cycle time only for unfinished cards that entered Doing", () => {
    const metrics: MetricsRecord[] = [
      {
        timestamp: "2026-03-18T09:00:00.000Z",
        cardId: "card-a",
        url: "https://trello.com/c/a",
        eventType: "entered",
        list: "Doing",
        labels: ["business"],
        secondsInList: null,
        completedDate: null,
      },
      {
        timestamp: "2026-03-18T09:30:00.000Z",
        cardId: "card-b",
        url: "https://trello.com/c/b",
        eventType: "entered",
        list: "Doing",
        labels: ["review"],
        secondsInList: null,
        completedDate: null,
      },
      {
        timestamp: "2026-03-18T09:45:00.000Z",
        cardId: "card-c",
        url: "https://trello.com/c/c",
        eventType: "entered",
        list: "Ready",
        labels: ["career"],
        secondsInList: null,
        completedDate: null,
      },
      {
        timestamp: "2026-03-18T10:00:00.000Z",
        cardId: "card-b",
        url: "https://trello.com/c/b",
        eventType: "entered",
        list: "Done",
        labels: ["review"],
        secondsInList: null,
        completedDate: "2026-03-18",
      },
    ];

    const data = buildLiveCycleTimeData({
      metrics,
      now: new Date("2026-03-18T11:00:00.000Z"),
    });

    expect(data.unfinishedCards).toBe(1);
    expect(data.cumulativeCycleTimeSeconds).toBe(2 * 60 * 60);
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]?.cardId).toBe("card-a");
    expect(data.cards[0]?.cycleTimeSeconds).toBe(2 * 60 * 60);
  });

  it("uses current Doing card states when provided", () => {
    const metrics: MetricsRecord[] = [
      {
        timestamp: "2026-03-18T10:00:00.000Z",
        cardId: "card-a",
        url: "https://trello.com/c/a",
        eventType: "entered",
        list: "Done",
        labels: ["business"],
        secondsInList: null,
        completedDate: "2026-03-18",
      },
    ];

    const data = buildLiveCycleTimeData({
      metrics,
      cardStates: [
        {
          cardId: "card-doing",
          list: "Doing",
          enteredAt: "2026-03-16T10:00:00.000Z",
          labels: ["career"],
          url: "https://trello.com/c/doing",
        },
      ],
      now: new Date("2026-03-18T10:00:00.000Z"),
    });

    expect(data.unfinishedCards).toBe(1);
    expect(data.cumulativeCycleTimeSeconds).toBe(2 * 24 * 60 * 60);
    expect(data.cards[0]?.cardId).toBe("card-doing");
  });

  it("filters live cycle cards by selected labels", () => {
    const data = buildLiveCycleTimeData({
      metrics: [],
      cardStates: [
        {
          cardId: "card-career",
          list: "Doing",
          enteredAt: "2026-03-16T10:00:00.000Z",
          labels: ["career", "schibsted"],
          url: "https://trello.com/c/career",
        },
        {
          cardId: "card-review",
          list: "Doing",
          enteredAt: "2026-03-16T10:00:00.000Z",
          labels: ["review", "schibsted"],
          url: "https://trello.com/c/review",
        },
      ],
      labels: ["career"],
      now: new Date("2026-03-18T10:00:00.000Z"),
    });

    expect(data.unfinishedCards).toBe(1);
    expect(data.cards[0]?.cardId).toBe("card-career");
    expect(data.cumulativeCycleTimeSeconds).toBe(2 * 24 * 60 * 60);
  });
});

describe("cycle-time snapshot helpers", () => {
  it("floors timestamps to 5-minute buckets", () => {
    expect(toFiveMinuteBucketIso(new Date("2026-03-18T11:03:45.100Z"))).toBe("2026-03-18T11:00:00.000Z");
    expect(toFiveMinuteBucketIso(new Date("2026-03-18T11:05:00.000Z"))).toBe("2026-03-18T11:05:00.000Z");
    expect(toFiveMinuteBucketIso(new Date("2026-03-18T11:59:59.999Z"))).toBe("2026-03-18T11:55:00.000Z");
  });

  it("deduplicates snapshots per bucket and keeps them ordered", () => {
    const merged = mergeCycleTimeSnapshots(
      [
        {
          at: "2026-03-18T11:00:00.000Z",
          cumulativeCycleTimeSeconds: 120,
          unfinishedCards: 1,
        },
        {
          at: "2026-03-18T11:05:00.000Z",
          cumulativeCycleTimeSeconds: 240,
          unfinishedCards: 2,
        },
      ],
      {
        at: "2026-03-18T11:05:00.000Z",
        cumulativeCycleTimeSeconds: 300,
        unfinishedCards: 3,
      },
    );

    expect(merged).toEqual([
      {
        at: "2026-03-18T11:00:00.000Z",
        cumulativeCycleTimeSeconds: 120,
        unfinishedCards: 1,
        cumulativeCycleTimeSecondsByLabel: {},
      },
      {
        at: "2026-03-18T11:05:00.000Z",
        cumulativeCycleTimeSeconds: 300,
        unfinishedCards: 3,
      },
    ]);
  });
});
