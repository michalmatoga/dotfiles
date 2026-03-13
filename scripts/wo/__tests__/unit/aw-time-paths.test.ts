import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPathToUrlMap } from "../../lib/metrics/aw-time";

describe("aw-time state path resolution", () => {
  const originalDotfilesDir = process.env.DOTFILES_DIR;
  const originalMetricsStateDir = process.env.WO_METRICS_STATE_DIR;
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalDotfilesDir === undefined) {
      delete process.env.DOTFILES_DIR;
    } else {
      process.env.DOTFILES_DIR = originalDotfilesDir;
    }

    if (originalMetricsStateDir === undefined) {
      delete process.env.WO_METRICS_STATE_DIR;
    } else {
      process.env.WO_METRICS_STATE_DIR = originalMetricsStateDir;
    }
  });

  it("reads worktree state from DOTFILES_DIR even when cwd differs", async () => {
    const dotfilesDir = await mkdtemp(join(tmpdir(), "wo-dotfiles-"));
    const otherCwd = await mkdtemp(join(tmpdir(), "wo-other-cwd-"));
    const stateDir = join(dotfilesDir, "scripts/wo/state");
    await mkdir(stateDir, { recursive: true });

    const snapshot = {
      ts: "2026-03-13T10:00:00.000Z",
      worktrees: {
        byUrl: {
          "https://trello.com/c/snapshot1": "/tmp/work/from-snapshot",
        },
      },
    };
    await writeFile(join(stateDir, "wo-snapshots.jsonl"), `${JSON.stringify(snapshot)}\n`);

    const event = {
      ts: "2026-03-13T10:01:00.000Z",
      type: "worktree.added",
      payload: {
        url: "https://trello.com/c/event1",
        path: "/tmp/work/from-event",
      },
    };
    await writeFile(join(stateDir, "wo-events.jsonl"), `${JSON.stringify(event)}\n`);

    process.env.DOTFILES_DIR = dotfilesDir;
    delete process.env.WO_METRICS_STATE_DIR;
    process.chdir(otherCwd);

    const map = await buildPathToUrlMap();

    expect(map.get("/tmp/work/from-snapshot")).toBe("https://trello.com/c/snapshot1");
    expect(map.get("/tmp/work/from-event")).toBe("https://trello.com/c/event1");
  });

  it("prefers WO_METRICS_STATE_DIR over DOTFILES_DIR", async () => {
    const dotfilesDir = await mkdtemp(join(tmpdir(), "wo-dotfiles-"));
    const overrideStateDir = await mkdtemp(join(tmpdir(), "wo-state-override-"));

    const snapshot = {
      ts: "2026-03-13T10:00:00.000Z",
      worktrees: {
        byUrl: {
          "https://trello.com/c/override1": "/tmp/work/from-override",
        },
      },
    };
    await writeFile(join(overrideStateDir, "wo-snapshots.jsonl"), `${JSON.stringify(snapshot)}\n`);
    await writeFile(join(overrideStateDir, "wo-events.jsonl"), "");

    process.env.DOTFILES_DIR = dotfilesDir;
    process.env.WO_METRICS_STATE_DIR = overrideStateDir;

    const map = await buildPathToUrlMap();

    expect(map.get("/tmp/work/from-override")).toBe("https://trello.com/c/override1");
  });
});
