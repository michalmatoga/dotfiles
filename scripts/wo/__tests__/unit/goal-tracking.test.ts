import {
  buildGoalRangeSnippetsFromMarkdown,
  defaultGoalTrackingSources,
} from "../../lib/metrics/goal-tracking";

describe("buildGoalRangeSnippetsFromMarkdown", () => {
  it("matches week and month blocks for selected ranges", () => {
    const markdown = [
      "# OT Career",
      "",
      "## Goal Setting to the Now",
      "",
      "### 2026",
      "",
      "#### February",
      "- [ ] Keep February baseline",
      "",
      "#### March",
      "##### Week 12",
      "- [ ] Week 12 item",
      "",
      "##### Week 13",
      "- [ ] Week 13 item",
      "",
      "## Metrics",
      "- velocity",
    ].join("\n");

    const snippets = buildGoalRangeSnippetsFromMarkdown(markdown, new Date("2026-03-24T10:00:00.000Z"));

    expect(snippets["this-week"].matchedHeading).toBe("Week 13");
    expect(snippets["this-week"].markdown).toContain("Week 13");
    expect(snippets["this-week"].markdown).toContain("Week 13 item");

    expect(snippets["this-month"].matchedHeading).toBe("March");
    expect(snippets["this-month"].markdown).toContain("#### March");
    expect(snippets["this-month"].markdown).toContain("Week 12");
    expect(snippets["all"].markdown).toContain("## Goal Setting to the Now");
    expect(snippets["all"].markdown).not.toContain("## Metrics");
  });

  it("falls back to previous week block when exact week is missing", () => {
    const markdown = [
      "# OT Business",
      "",
      "## Goal Setting to the Now",
      "### 2026",
      "#### March",
      "##### Week 10",
      "- [ ] Week 10 item",
      "##### Week 11",
      "- [ ] Week 11 item",
    ].join("\n");

    const snippets = buildGoalRangeSnippetsFromMarkdown(markdown, new Date("2026-03-24T10:00:00.000Z"));

    expect(snippets.today.matchedHeading).toBe("Week 11");
    expect(snippets.today.markdown).toContain("Week 11 item");
  });

  it("uses Today block for today range when present", () => {
    const markdown = [
      "# Household",
      "",
      "## Goal Setting to the Now",
      "### 2026",
      "#### March",
      "##### Week 13",
      "- [ ] Week 13 item",
      "###### Today",
      "- [ ] Today item",
      "##### Week 12",
      "- [ ] Week 12 item",
    ].join("\n");

    const snippets = buildGoalRangeSnippetsFromMarkdown(markdown, new Date("2026-03-24T10:00:00.000Z"));

    expect(snippets.today.matchedHeading).toBe("Today");
    expect(snippets.today.markdown).toContain("Today item");
    expect(snippets.today.markdown).not.toContain("Week 13 item");
    expect(snippets["this-week"].matchedHeading).toBe("Week 13");
  });

  it("returns explicit missing-section fallback", () => {
    const markdown = [
      "# OT Career",
      "",
      "## Purpose",
      "- Improve things",
    ].join("\n");

    const snippets = buildGoalRangeSnippetsFromMarkdown(markdown, new Date("2026-03-24T10:00:00.000Z"));

    expect(snippets["this-week"].hasContent).toBe(false);
    expect(snippets["this-week"].markdown).toContain("Goal section not found");
    expect(snippets["this-month"].hasContent).toBe(false);
  });
});

describe("defaultGoalTrackingSources", () => {
  it("maps all LSS component notes to area labels", () => {
    expect(defaultGoalTrackingSources).toEqual([
      expect.objectContaining({
        id: "business",
        notePath: expect.stringContaining("/ot-business.md"),
        labels: ["business"],
      }),
      expect.objectContaining({
        id: "career",
        notePath: expect.stringContaining("/ot-career.md"),
        labels: ["career", "career-delivery", "review"],
      }),
      expect.objectContaining({
        id: "health",
        notePath: expect.stringContaining("/ot-health.md"),
        labels: ["health"],
      }),
      expect.objectContaining({
        id: "growth",
        notePath: expect.stringContaining("/growth.md"),
        labels: ["growth"],
      }),
      expect.objectContaining({
        id: "household",
        notePath: expect.stringContaining("/household.md"),
        labels: ["household"],
      }),
      expect.objectContaining({
        id: "relationships",
        notePath: expect.stringContaining("/ot-relations.md"),
        labels: ["relationships"],
      }),
    ]);
  });
});
