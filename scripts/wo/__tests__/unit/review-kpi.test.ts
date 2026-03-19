import { buildReviewKpiData } from "../../lib/metrics/review-kpi";

describe("buildReviewKpiData", () => {
  it("counts delivered, archived, and re-requested events", () => {
    const reviewKpi = buildReviewKpiData({
      now: new Date("2026-03-19T12:00:00.000Z"),
      events: [
        {
          ts: "2026-03-10T10:00:00.000Z",
          type: "trello.review.done",
          payload: { cardId: "a", url: "https://x/pull/1" },
        },
        {
          ts: "2026-03-10T11:00:00.000Z",
          type: "trello.review.re-requested",
          payload: { cardId: "a", url: "https://x/pull/1" },
        },
        {
          ts: "2026-03-10T12:00:00.000Z",
          type: "trello.review.archived.merged",
          payload: { cardId: "b", url: "https://x/pull/2" },
        },
        {
          ts: "2026-03-10T13:00:00.000Z",
          type: "trello.card.updated",
          payload: { cardId: "ignore" },
        },
      ],
    });

    expect(reviewKpi.totals.requested).toBe(3);
    expect(reviewKpi.totals.delivered).toBe(1);
    expect(reviewKpi.totals.missed).toBe(1);
    expect(reviewKpi.totals.deliveryRatePct).toBeCloseTo(33.333, 2);
    expect(reviewKpi.points).toHaveLength(3);
    expect(reviewKpi.points.map((point) => point.eventType)).toEqual([
      "delivered",
      "re-requested",
      "missed",
    ]);
    expect(reviewKpi.points.map((point) => point.requestedCumulative)).toEqual([1, 2, 3]);
  });

  it("handles empty event stream", () => {
    const reviewKpi = buildReviewKpiData({
      now: new Date("2026-03-19T12:00:00.000Z"),
      events: [],
    });

    expect(reviewKpi.totals).toEqual({
      requested: 0,
      delivered: 0,
      missed: 0,
      deliveryRatePct: null,
    });
    expect(reviewKpi.points).toEqual([]);
  });
});
