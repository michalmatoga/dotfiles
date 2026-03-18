import { describe, expect, it } from "vitest";

import { normalizeLinkedUrl, normalizeLinkedUrlValue } from "../../lib/url";

describe("normalizeLinkedUrlValue", () => {
  it("returns plain URLs unchanged", () => {
    expect(normalizeLinkedUrlValue("https://trello.com/c/cNzVuXpR/157-lock-in-metrics")).toBe(
      "https://trello.com/c/cNzVuXpR/157-lock-in-metrics",
    );
  });

  it("extracts URLs from markdown smart-card format", () => {
    expect(
      normalizeLinkedUrlValue(
        '[https://trello.com/c/cNzVuXpR/157-lock-in-metrics](https://trello.com/c/cNzVuXpR/157-lock-in-metrics "smartCard-inline")',
      ),
    ).toBe("https://trello.com/c/cNzVuXpR/157-lock-in-metrics");
  });

  it("extracts the first URL from mixed text", () => {
    expect(normalizeLinkedUrlValue("See https://trello.com/c/cNzVuXpR/157-lock-in-metrics for details")).toBe(
      "https://trello.com/c/cNzVuXpR/157-lock-in-metrics",
    );
  });
});

describe("normalizeLinkedUrl", () => {
  it("returns null for empty or missing values", () => {
    expect(normalizeLinkedUrl(null)).toBeNull();
    expect(normalizeLinkedUrl(undefined)).toBeNull();
    expect(normalizeLinkedUrl("   ")).toBeNull();
  });
});
