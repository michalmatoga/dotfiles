import { afterEach, describe, expect, it } from "vitest";

import { buildInitialOpencodeArgs, resolveOpencodeModel } from "../../lib/opencode";

describe("opencode initial session args", () => {
  const originalModel = process.env.OPENCODE_MODEL;

  afterEach(() => {
    if (typeof originalModel === "string") {
      process.env.OPENCODE_MODEL = originalModel;
      return;
    }
    delete process.env.OPENCODE_MODEL;
  });

  it("uses OPENCODE_MODEL when present", () => {
    process.env.OPENCODE_MODEL = "litellm/bedrock-claude-opus-4-5";
    expect(resolveOpencodeModel()).toBe("litellm/bedrock-claude-opus-4-5");
  });

  it("falls back to the default model when OPENCODE_MODEL is unset", () => {
    delete process.env.OPENCODE_MODEL;
    expect(resolveOpencodeModel()).toBe("openai/gpt-5.3-codex");
  });

  it("builds initial args with explicit plan agent and model", () => {
    const args = buildInitialOpencodeArgs({
      title: "Issue42: Harden startup",
      prompt: "Do the work",
      model: "openai/gpt-5.3-codex",
    });

    expect(args).toEqual([
      "run",
      "--format",
      "json",
      "--agent",
      "plan",
      "--model",
      "openai/gpt-5.3-codex",
      "--title",
      "Issue42: Harden startup",
      "Do the work",
    ]);
  });
});
