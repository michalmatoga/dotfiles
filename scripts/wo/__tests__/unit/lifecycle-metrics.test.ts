import { rm } from "node:fs/promises";
import { join } from "node:path";

import { getCardMetrics, getThroughput, readMetrics, recordCardMove } from "../../lib/metrics/lifecycle";

const testStateDir = join(__dirname, "..", "state", "lifecycle-metrics");
const metricsFiles = [
  join(testStateDir, "wo-metrics.csv"),
  join(testStateDir, "wo-card-states.jsonl"),
];

describe("lifecycle metrics", () => {
  const originalMetricsStateDir = process.env.WO_METRICS_STATE_DIR;

  beforeAll(() => {
    process.env.WO_METRICS_STATE_DIR = testStateDir;
  });

  afterAll(() => {
    if (typeof originalMetricsStateDir === "string") {
      process.env.WO_METRICS_STATE_DIR = originalMetricsStateDir;
      return;
    }
    delete process.env.WO_METRICS_STATE_DIR;
  });

  beforeEach(async () => {
    await Promise.all(metricsFiles.map((file) => rm(file, { force: true })));
  });

  it("tracks lead and cycle time when a card lands in Done", async () => {
    const cardId = "card-1";
    const labels = ["household"];

    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-1",
      fromList: null,
      toList: "Ready",
      labels,
      now: "2026-03-01T10:00:00.000Z",
    });
    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-1",
      fromList: "Ready",
      toList: "Doing",
      labels,
      now: "2026-03-01T12:00:00.000Z",
    });
    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-1",
      fromList: "Doing",
      toList: "Done",
      labels,
      now: "2026-03-01T15:00:00.000Z",
    });

    const metrics = await getCardMetrics(cardId);
    expect(metrics.touchTime).toBe(3 * 60 * 60);
    expect(metrics.waitTime).toBe(0);
    expect(metrics.cycleTime).toBe(3 * 60 * 60);
    expect(metrics.leadTime).toBe(5 * 60 * 60);

    const throughput = await getThroughput({
      startDate: "2026-03-01",
      endDate: "2026-03-01",
      label: "household",
    });
    expect(throughput).toBe(1);
  });

  it("is idempotent for repeated move detection", async () => {
    const cardId = "card-2";
    const labels = ["household"];

    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-2",
      fromList: null,
      toList: "Doing",
      labels,
      now: "2026-03-02T09:00:00.000Z",
    });
    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-2",
      fromList: "Doing",
      toList: "Done",
      labels,
      now: "2026-03-02T10:00:00.000Z",
    });
    await recordCardMove({
      cardId,
      url: "https://trello.com/c/card-2",
      fromList: "Doing",
      toList: "Done",
      labels,
      now: "2026-03-02T10:05:00.000Z",
    });

    const doneEntries = (await readMetrics()).filter(
      (row) => row.eventType === "entered" && row.list === "Done" && row.cardId === cardId,
    );
    expect(doneEntries).toHaveLength(1);
  });
});
