import { getPrimaryLabel, normalizeMetricLabels } from "../../lib/metrics/types";

describe("metrics label typing", () => {
  it("normalizes and deduplicates labels", () => {
    expect(normalizeMetricLabels([" Career", "career-delivery", "career ", ""])).toEqual([
      "career",
      "career-delivery",
    ]);
  });

  it("prefers career-delivery over career for imported delivery cards", () => {
    expect(getPrimaryLabel(["career", "career-delivery"])).toBe("career-delivery");
  });

  it("keeps review ahead of career-delivery when both are present", () => {
    expect(getPrimaryLabel(["career", "career-delivery", "review"])).toBe("review");
  });
});
