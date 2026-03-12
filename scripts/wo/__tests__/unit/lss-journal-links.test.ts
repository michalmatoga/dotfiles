import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { injectTrelloUrlIntoTaskLine } from "../../lib/lss/journal-links";
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
});
