export type ReviewKpiPoint = {
  at: string;
  requestedDelta: number;
  deliveredDelta: number;
  missedDelta: number;
  requestedCumulative: number;
  deliveredCumulative: number;
  missedCumulative: number;
  eventType: "delivered" | "missed" | "re-requested";
  cardId: string | null;
  url: string | null;
};

export type ReviewKpiData = {
  generatedAt: string;
  totals: {
    requested: number;
    delivered: number;
    missed: number;
    deliveryRatePct: number | null;
  };
  points: ReviewKpiPoint[];
};

type EventRecord = {
  ts?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

const toText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const buildReviewKpiData = (options: {
  now: Date;
  events: EventRecord[];
}): ReviewKpiData => {
  const points: ReviewKpiPoint[] = [];
  let requested = 0;
  let delivered = 0;
  let missed = 0;

  const sortedEvents = [...options.events].sort((a, b) => {
    const aMs = Date.parse(a.ts ?? "");
    const bMs = Date.parse(b.ts ?? "");
    if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
      return aMs - bMs;
    }
    if (Number.isFinite(aMs)) {
      return -1;
    }
    if (Number.isFinite(bMs)) {
      return 1;
    }
    return 0;
  });

  for (const event of sortedEvents) {
    const at = toText(event.ts);
    if (!at) {
      continue;
    }

    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const cardId = toText(payload.cardId);
    const url = toText(payload.url);
    const eventType = toText(event.type);

    if (eventType === "trello.review.done") {
      requested += 1;
      delivered += 1;
      points.push({
        at,
        requestedDelta: 1,
        deliveredDelta: 1,
        missedDelta: 0,
        requestedCumulative: requested,
        deliveredCumulative: delivered,
        missedCumulative: missed,
        eventType: "delivered",
        cardId,
        url,
      });
      continue;
    }

    if (eventType === "trello.review.archived.merged") {
      requested += 1;
      missed += 1;
      points.push({
        at,
        requestedDelta: 1,
        deliveredDelta: 0,
        missedDelta: 1,
        requestedCumulative: requested,
        deliveredCumulative: delivered,
        missedCumulative: missed,
        eventType: "missed",
        cardId,
        url,
      });
      continue;
    }

    if (eventType === "trello.review.re-requested") {
      requested += 1;
      points.push({
        at,
        requestedDelta: 1,
        deliveredDelta: 0,
        missedDelta: 0,
        requestedCumulative: requested,
        deliveredCumulative: delivered,
        missedCumulative: missed,
        eventType: "re-requested",
        cardId,
        url,
      });
    }
  }

  return {
    generatedAt: options.now.toISOString(),
    totals: {
      requested,
      delivered,
      missed,
      deliveryRatePct: requested > 0 ? (delivered / requested) * 100 : null,
    },
    points,
  };
};
