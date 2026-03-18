import { beforeEach, describe, expect, it, vi } from "vitest";

const { ghJsonMock, fetchCardDetailsByShortIdMock } = vi.hoisted(() => ({
  ghJsonMock: vi.fn(),
  fetchCardDetailsByShortIdMock: vi.fn(),
}));

vi.mock("../../lib/gh/gh", () => ({
  ghJson: ghJsonMock,
}));

vi.mock("../../lib/trello/cards", () => ({
  fetchCardDetailsByShortId: fetchCardDetailsByShortIdMock,
}));

import { buildPromptSeed, truncateForPrompt, type UrlInfo } from "../../lib/sessions/tmux";

describe("tmux prompt context prefetch", () => {
  beforeEach(() => {
    ghJsonMock.mockReset();
    fetchCardDetailsByShortIdMock.mockReset();
  });

  it("builds issue prompt context from prefetched issue data", async () => {
    ghJsonMock.mockResolvedValueOnce({
      title: "Fix flaky test",
      body: "Investigate and stabilize flaky acceptance test.",
      state: "OPEN",
      author: { login: "octo-dev" },
      assignees: [{ login: "alice" }],
      labels: [{ name: "bug" }, { name: "tests" }],
      comments: [
        {
          author: { login: "reviewer" },
          body: "This started after cache refactor.",
          createdAt: "2026-03-18T08:10:00Z",
        },
      ],
    });

    const info: UrlInfo = {
      kind: "issue",
      host: "github.com",
      owner: "acme",
      repo: "widget",
      number: "42",
    };
    const seed = await buildPromptSeed({
      info,
      url: "https://github.com/acme/widget/issues/42",
    });

    expect(seed.title).toBe("Fix flaky test");
    expect(seed.prefetchedContext).toContain("## Prefetched Context");
    expect(seed.prefetchedContext).toContain("Issue state: OPEN");
    expect(seed.prefetchedContext).toContain("- bug");
    expect(seed.prefetchedContext).toContain("reviewer");
  });

  it("builds PR prompt context from prefetched PR data", async () => {
    ghJsonMock.mockResolvedValueOnce({
      title: "Add guardrails",
      body: "Hardens session init.",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      baseRefName: "main",
      headRefName: "feature/hardening",
      author: { login: "dev1" },
      reviewRequests: [{ login: "reviewer1" }],
      reviews: [
        {
          author: { login: "reviewer2" },
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-03-18T09:00:00Z",
          body: "Please add tests.",
        },
      ],
      files: [{ path: "scripts/wo/lib/sessions/tmux.ts", additions: 50, deletions: 10 }],
      commits: [{ oid: "1234567890abcdef", messageHeadline: "wire prompt prefetch" }],
    });

    const info: UrlInfo = {
      kind: "pr",
      host: "github.com",
      owner: "acme",
      repo: "widget",
      number: "77",
    };
    const seed = await buildPromptSeed({
      info,
      url: "https://github.com/acme/widget/pull/77",
    });

    expect(seed.title).toBe("Add guardrails");
    expect(seed.prefetchedContext).toContain("Merge state: CLEAN");
    expect(seed.prefetchedContext).toContain("scripts/wo/lib/sessions/tmux.ts (+50 / -10)");
    expect(seed.prefetchedContext).toContain("wire prompt prefetch");
    expect(seed.prefetchedContext).toContain("CHANGES_REQUESTED");
  });

  it("builds Trello prompt context from prefetched card data", async () => {
    fetchCardDetailsByShortIdMock.mockResolvedValueOnce({
      id: "card1",
      name: "Harden session startup",
      desc: "Ensure deterministic setup.",
      url: "https://trello.com/c/abcd1234/1-hardening",
      shortUrl: "https://trello.com/c/abcd1234",
      labels: [{ id: "l1", name: "dotfiles", color: "blue" }],
      checklists: [
        {
          id: "cl1",
          name: "Definition of done",
          checkItems: [{ id: "it1", name: "Add tests", state: "incomplete", pos: 1 }],
        },
      ],
    });

    const info: UrlInfo = {
      kind: "trello",
      shortId: "abcd1234",
    };
    const seed = await buildPromptSeed({
      info,
      url: "https://trello.com/c/abcd1234/1-hardening",
    });

    expect(seed.title).toBe("Harden session startup");
    expect(seed.prefetchedContext).toContain("Labels:");
    expect(seed.prefetchedContext).toContain("dotfiles (blue)");
    expect(seed.prefetchedContext).toContain("[ ] Add tests");
  });

  it("falls back safely when context prefetch fails", async () => {
    ghJsonMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ title: "Fallback issue title" });

    const info: UrlInfo = {
      kind: "issue",
      host: "github.com",
      owner: "acme",
      repo: "widget",
      number: "9",
    };
    const seed = await buildPromptSeed({
      info,
      url: "https://github.com/acme/widget/issues/9",
      providedTitle: "Provided title",
    });

    expect(seed.title).toBe("Fallback issue title");
    expect(seed.prefetchedContext).toContain("context prefetch failed");
  });

  it("truncates long prompt values with a marker", () => {
    const long = "x".repeat(32);
    const truncated = truncateForPrompt(long, 10);
    expect(truncated).toContain("... [truncated]");
  });
});
