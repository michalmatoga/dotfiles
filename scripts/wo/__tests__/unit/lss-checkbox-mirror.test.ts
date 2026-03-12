import { parseLssInitiativesFromMarkdown } from "../../lib/lss/tasks";
import { planLssCheckboxMirror } from "../../lib/lss/checkbox-mirror";

describe("LSS Trello to journal checkbox mirror", () => {
  it("plans checkbox patch by Trello URL regardless of heading location", () => {
    const initiatives = parseLssInitiativesFromMarkdown({
      noteId: "ot-household",
      filePath: "/tmp/ot-household.md",
      markdown: [
        "## Goal Setting to the Now",
        "### Month",
        "#### Deep nesting",
        "- [ ] [Repair sink](https://trello.com/c/AbCd1234)",
      ].join("\n"),
    });

    const plan = planLssCheckboxMirror({
      initiatives,
      managedCards: [
        {
          cardId: "card-1",
          trelloUrl: "https://trello.com/c/AbCd1234",
          listId: "list-done",
        },
      ],
      listById: new Map([
        ["list-done", "Done"],
      ]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.patches).toEqual([
      expect.objectContaining({
        noteId: "ot-household",
        line: 4,
        checked: true,
        trelloUrl: "https://trello.com/c/AbCd1234",
      }),
    ]);
  });

  it("detects conflict when same Trello URL appears in multiple tasks", () => {
    const initiatives = parseLssInitiativesFromMarkdown({
      noteId: "ot-household",
      filePath: "/tmp/ot-household.md",
      markdown: [
        "## Goal Setting to the Now",
        "### Month",
        "- [ ] [Repair sink](https://trello.com/c/AbCd1234)",
        "### Week",
        "- [ ] [Repair sink now](https://trello.com/c/AbCd1234)",
      ].join("\n"),
    });

    const plan = planLssCheckboxMirror({
      initiatives,
      managedCards: [
        {
          cardId: "card-1",
          trelloUrl: "https://trello.com/c/AbCd1234",
          listId: "list-ready",
        },
      ],
      listById: new Map([
        ["list-ready", "Ready"],
      ]),
    });

    expect(plan.patches).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        trelloUrl: "https://trello.com/c/AbCd1234",
        reason: "multiple-tasks",
      }),
    ]);
  });
});
