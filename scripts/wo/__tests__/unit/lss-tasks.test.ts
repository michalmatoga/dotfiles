import {
  derivePlannerCards,
  parseLssInitiativesFromMarkdown,
  planLssInitiativeActions,
  resolveRepoLabelFromFrontmatter,
} from "../../lib/lss/tasks";

describe("LSS task parsing", () => {
  it("parses only checkbox tasks under Goal Setting to the Now and heading level 3+", () => {
    const markdown = [
      "# Business",
      "## Goal Setting to the Now",
      "- [ ] outside level 3 and must be ignored",
      "### This Quarter",
      "- [ ] Keep this one",
      "#### Milestones",
      "- [x] Done item https://trello.com/c/AbCd1234/some-slug",
      "## Other",
      "### Not in scope",
      "- [ ] Ignore this",
    ].join("\n");

    const tasks = parseLssInitiativesFromMarkdown({
      noteId: "ot-business",
      filePath: "/tmp/ot-business.md",
      markdown,
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      noteId: "ot-business",
      line: 5,
      checked: false,
      text: "Keep this one",
      trelloUrl: null,
      headingPath: ["This Quarter"],
      conflict: false,
    });
    expect(tasks[1]).toMatchObject({
      line: 7,
      checked: true,
      trelloUrl: "https://trello.com/c/AbCd1234",
      headingPath: ["This Quarter", "Milestones"],
      conflict: false,
    });
  });

  it("marks duplicate unlinked tasks in a note as conflicts", () => {
    const markdown = [
      "## Goal Setting to the Now",
      "### Month",
      "- [ ] Ship onboarding flow",
      "### Week",
      "- [ ] Ship onboarding flow",
    ].join("\n");

    const tasks = parseLssInitiativesFromMarkdown({
      noteId: "ot-business",
      filePath: "/tmp/ot-business.md",
      markdown,
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.conflict)).toBe(true);
  });

  it("strips markdown link wrapper from initiative text", () => {
    const markdown = [
      "## Goal Setting to the Now",
      "### Week",
      "- [ ] [svp/infrastructure #568 Improve pulumi setup for LKE](https://trello.com/c/TkmXAAvB/14-svp-infrastructure-568-improve-pulumi-setup-for-lke)",
    ].join("\n");

    const tasks = parseLssInitiativesFromMarkdown({
      noteId: "ot-career",
      filePath: "/tmp/ot-career.md",
      markdown,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      text: "svp/infrastructure #568 Improve pulumi setup for LKE",
      trelloUrl: "https://trello.com/c/TkmXAAvB",
    });
  });
});

describe("LSS dry-run planner", () => {
  it("plans link, create, check and uncheck actions deterministically", () => {
    const initiatives = parseLssInitiativesFromMarkdown({
      noteId: "ot-business",
      filePath: "/tmp/ot-business.md",
      markdown: [
        "## Goal Setting to the Now",
        "### This Quarter",
        "- [ ] Existing unlinked task",
        "- [x] Existing linked done mismatch https://trello.com/c/linked123",
        "- [ ] Existing linked undone mismatch https://trello.com/c/done123",
        "- [ ] Brand new task",
      ].join("\n"),
    });

    const cards = derivePlannerCards({
      cards: [
        {
          id: "c1",
          name: "Existing unlinked task",
          idList: "l-ready",
          idLabels: ["label-business"],
          shortUrl: "https://trello.com/c/matched111",
        },
        {
          id: "c2",
          name: "Existing linked done mismatch",
          idList: "l-ready",
          idLabels: ["label-business"],
          url: "https://trello.com/c/linked123/abc",
        },
        {
          id: "c3",
          name: "Existing linked undone mismatch",
          idList: "l-done",
          idLabels: ["label-business"],
          url: "https://trello.com/c/done123/abc",
        },
      ],
      labelNameById: new Map([["label-business", "business"]]),
      areas: [
        { label: "business", title: "Business", noteId: "ot-business" },
      ],
    });

    const plan = planLssInitiativeActions({
      initiatives,
      cards,
      listById: new Map([
        ["l-ready", "Ready"],
        ["l-done", "Done"],
      ]),
    });

    expect(plan.warnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        type: "link",
        line: 3,
        cardId: "c1",
      }),
      expect.objectContaining({
        type: "check",
        line: 4,
        cardId: "c2",
      }),
      expect.objectContaining({
        type: "uncheck",
        line: 5,
        cardId: "c3",
      }),
      expect.objectContaining({
        type: "create",
        line: 6,
      }),
    ]);
  });
});

describe("LSS repo label resolution", () => {
  it("returns single when note has exactly one repo-* tag", () => {
    const markdown = [
      "---",
      "id: ot-business",
      "tags:",
      "  - repo-elikonas",
      "  - focus",
      "---",
      "",
      "# Business",
    ].join("\n");

    expect(resolveRepoLabelFromFrontmatter(markdown)).toEqual({
      status: "single",
      label: "elikonas",
    });
  });

  it("returns none when note has no repo-* tag", () => {
    const markdown = [
      "---",
      "id: ot-business",
      "tags:",
      "  - business",
      "---",
    ].join("\n");

    expect(resolveRepoLabelFromFrontmatter(markdown)).toEqual({ status: "none" });
  });

  it("returns multiple when note has more than one repo-* tag", () => {
    const markdown = [
      "---",
      "id: ot-business",
      "tags: [repo-elikonas, repo-dotfiles]",
      "---",
    ].join("\n");

    expect(resolveRepoLabelFromFrontmatter(markdown)).toEqual({
      status: "multiple",
      labels: ["elikonas", "dotfiles"],
    });
  });
});
