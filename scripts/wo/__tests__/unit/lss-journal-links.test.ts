import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendRecurringTaskUnderClosestPlanningSlot,
  appendTaskUnderDeepestPlanningHeading,
  convertTaskCheckboxToRecurringHistoryAtLine,
  injectTrelloUrlIntoTaskLine,
  setTaskCheckboxStateAtLine,
} from "../../lib/lss/journal-links";
import { formatSyncMetadata, parseSyncMetadata } from "../../lib/sync/metadata";

describe("LSS journal backlink injection", () => {
  it("writes canonical Trello URL to exact task line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### Week",
        "- [ ] Improve onboarding",
      ].join("\n"),
      "utf8",
    );

    const result = await injectTrelloUrlIntoTaskLine({
      filePath,
      line: 3,
      trelloUrl: "https://trello.com/c/AbCd1234/some-slug",
    });

    expect(result).toEqual({ updated: true });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[2]).toBe("- [ ] [Improve onboarding](https://trello.com/c/AbCd1234)");
  });

  it("rewrites plain-url linked task to markdown link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### Week",
        "- [ ] Improve onboarding https://trello.com/c/AbCd1234",
      ].join("\n"),
      "utf8",
    );

    const result = await injectTrelloUrlIntoTaskLine({
      filePath,
      line: 3,
      trelloUrl: "https://trello.com/c/AbCd1234/another-slug",
    });

    expect(result).toEqual({ updated: true });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[2]).toBe("- [ ] [Improve onboarding](https://trello.com/c/AbCd1234)");
  });

  it("does not rewrite line when task is already markdown-linked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### Week",
        "- [ ] [Improve onboarding](https://trello.com/c/AbCd1234)",
      ].join("\n"),
      "utf8",
    );

    const result = await injectTrelloUrlIntoTaskLine({
      filePath,
      line: 3,
      trelloUrl: "https://trello.com/c/AbCd1234/another-slug",
    });

    expect(result).toEqual({ updated: false, reason: "already-linked" });
  });

  it("toggles checkbox marker only for linked task line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### Week",
        "- [ ] [Improve onboarding](https://trello.com/c/AbCd1234)",
      ].join("\n"),
      "utf8",
    );

    const result = await setTaskCheckboxStateAtLine({
      filePath,
      line: 3,
      checked: true,
    });

    expect(result).toEqual({ updated: true });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[2]).toBe("- [x] [Improve onboarding](https://trello.com/c/AbCd1234)");
  });
});

describe("sync metadata for lss source", () => {
  it("round-trips note_id/task_key/journal_state fields", () => {
    const block = formatSyncMetadata({
      source: "lss",
      noteId: "ot-career",
      taskKey: "ot-career::improve onboarding",
      journalState: "checked",
      lastSeen: "2026-03-12T00:00:00.000Z",
    });

    expect(parseSyncMetadata(block)).toMatchObject({
      source: "lss",
      noteId: "ot-career",
      taskKey: "ot-career::improve onboarding",
      journalState: "checked",
      lastSeen: "2026-03-12T00:00:00.000Z",
    });
  });

  it("normalizes markdown smart-card URLs from metadata", () => {
    const block = [
      "[wo-sync]",
      "source=lss",
      "url=[https://trello.com/c/cNzVuXpR/157-lock-in-metrics](https://trello.com/c/cNzVuXpR/157-lock-in-metrics \"smartCard-inline\")",
      "[/wo-sync]",
    ].join("\n");

    expect(parseSyncMetadata(block)).toMatchObject({
      source: "lss",
      url: "https://trello.com/c/cNzVuXpR/157-lock-in-metrics",
    });
  });
});

describe("LSS journal backfill insertion", () => {
  it("appends task under deepest active planning heading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### 2026",
        "#### March",
        "##### Week 12",
        "- [ ] Existing task",
        "##### Week 11",
        "- [ ] Current week task",
      ].join("\n"),
      "utf8",
    );

    const result = await appendTaskUnderDeepestPlanningHeading({
      filePath,
      text: "Backfilled task",
      trelloUrl: "https://trello.com/c/KWdx4kBz/154-something",
    });

    expect(result).toEqual({ updated: true, line: 8 });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[7]).toBe("- [ ] [Backfilled task](https://trello.com/c/KWdx4kBz)");
  });

  it("returns already-linked when URL already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "ot-business.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### Week",
        "- [ ] [Existing](https://trello.com/c/KWdx4kBz)",
      ].join("\n"),
      "utf8",
    );

    const result = await appendTaskUnderDeepestPlanningHeading({
      filePath,
      text: "Backfilled task",
      trelloUrl: "https://trello.com/c/KWdx4kBz/154-something",
    });

    expect(result).toEqual({ updated: false, reason: "already-linked" });
  });
});

describe("LSS recurring journal rollover", () => {
  it("converts checked checkbox into emoji history while keeping Trello link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "household.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### 2026",
        "#### March",
        "##### Week 12",
        "- [x] [Fold laundry](https://trello.com/c/AbCd1234)",
      ].join("\n"),
      "utf8",
    );

    const result = await convertTaskCheckboxToRecurringHistoryAtLine({
      filePath,
      line: 5,
      doneDate: "2026-03-23",
    });

    expect(result).toEqual({
      updated: true,
      text: "Fold laundry",
      trelloUrl: "https://trello.com/c/AbCd1234",
    });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[4]).toBe("- ✅ [Fold laundry](https://trello.com/c/AbCd1234) (done 2026-03-23)");
  });

  it("inserts active recurring task under due week slot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "household.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### 2026",
        "#### March",
        "##### Week 13",
        "- ✅ [Fold laundry](https://trello.com/c/AbCd1234) (done 2026-03-23)",
      ].join("\n"),
      "utf8",
    );

    const result = await appendRecurringTaskUnderClosestPlanningSlot({
      filePath,
      text: "Fold laundry",
      trelloUrl: "https://trello.com/c/AbCd1234",
      due: "2026-03-30T09:00:00.000Z",
      sourceHeadingPath: ["2026", "March", "Week 13"],
    });

    expect(result).toEqual({ updated: true, line: 6 });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[5]).toBe("- [ ] [Fold laundry](https://trello.com/c/AbCd1234)");
  });

  it("bubbles up to month heading when due week slot is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wo-lss-"));
    const filePath = join(dir, "household.md");
    await writeFile(
      filePath,
      [
        "## Goal Setting to the Now",
        "### 2026",
        "#### April",
        "- ✅ [Fold laundry](https://trello.com/c/AbCd1234) (done 2026-03-23)",
        "### Someday",
      ].join("\n"),
      "utf8",
    );

    const result = await appendRecurringTaskUnderClosestPlanningSlot({
      filePath,
      text: "Fold laundry",
      trelloUrl: "https://trello.com/c/AbCd1234",
      due: "2026-04-28T09:00:00.000Z",
      sourceHeadingPath: ["2026", "April", "Week 17"],
    });

    expect(result).toEqual({ updated: true, line: 5 });
    const content = await readFile(filePath, "utf8");
    expect(content.split("\n")[4]).toBe("- [ ] [Fold laundry](https://trello.com/c/AbCd1234)");
  });
});
