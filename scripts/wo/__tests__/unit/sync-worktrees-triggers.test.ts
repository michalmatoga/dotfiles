import { describe, it, expect } from "vitest";
import { listNames } from "../../lib/policy/mapping";
import { parseListConfig } from "../../use-cases/sync-worktrees";

describe("sync-worktrees trigger configuration", () => {
  it("defaults to Ready and Doing when trigger env is missing", () => {
    expect(parseListConfig(undefined, [listNames.ready, listNames.doing])).toEqual([
      listNames.ready,
      listNames.doing,
    ]);
  });

  it("trims and keeps configured trigger lists", () => {
    expect(parseListConfig(" Ready,Doing ", [listNames.ready])).toEqual([
      listNames.ready,
      listNames.doing,
    ]);
  });

  it("falls back when trigger env is blank", () => {
    expect(parseListConfig("   ", [listNames.ready, listNames.doing])).toEqual([
      listNames.ready,
      listNames.doing,
    ]);
  });
});
