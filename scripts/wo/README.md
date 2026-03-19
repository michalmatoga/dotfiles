# Workflow Orchestration (wo)

New workflow system based on the use-case pattern. It syncs assigned work and review requests
from GitHub Enterprise into a unified Trello board, and pushes Trello list moves back to GitHub
for Schibsted-labeled cards.

## What it does

- Pulls assigned items from `svp` Project #5 and creates/updates Trello cards.
- Pulls GitHub review requests and creates/updates Trello cards.
- Syncs LSS journal initiatives into Trello (create/link/update-title + backlink write).
- Mirrors Trello Done state back to linked LSS journal checkboxes for `source=lss` cards.
- Moves Trello list changes back to GitHub project status (only for `schibsted` label).
- Auto-moves review cards to Done once you approve the PR.

## Use-case layout

- `scripts/wo/main.ts` runs the use-cases in order.
- `scripts/wo/use-cases/*` are the high-level flow descriptions (flat, readable steps).
- `scripts/wo/lib/*` holds adapters (Trello/GitHub), policy, sync logic, and state.

## Trello board model

Lists:

- Triage
- Ready
- Doing
- Waiting
- Done

Note: native Trello Inbox is used outside this required workflow list set.

Labels (lowercase):

- business
- career
- health
- growth
- relationships
- schibsted
- review
- household
- elikonas
- journal
- dotfiles

## Status mapping

GitHub Project status -> Trello list:

- `🔍 Design, Research and Investigation` -> `Triage`
- `📋 Ready` / `🔖 Next up` -> `Ready`
- `🏗 In progress` -> `Doing`
- `👀 In review` -> `Waiting`
- `✅ Done` -> `Done`
- `🚫 Blocked` -> `Waiting`

Trello list -> GitHub Project status (only for `schibsted` label):

- `Ready` -> `📋 Ready`
- `Doing` -> `🏗 In progress`
- `Waiting` -> `👀 In review` if `review` label, otherwise `🚫 Blocked`
- `Done` -> `✅ Done`

## Setup

Create a new Trello board in the same workspace as the existing one:

```bash
npx --yes tsx scripts/wo/main.ts --init-board
```

Then set the board ID:

```bash
export TRELLO_BOARD_ID_WO="<board-id>"
```

Required env vars (from `.env`):

- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `TRELLO_BOARD_ID_WO`

Board identifiers and tokens live in `.env` (do not hardcode them in the repo).

## Run

```bash
npx --yes tsx scripts/wo/main.ts --verbose
```

Flags:

- `--dry-run` prints actions without mutating Trello/GitHub.
- `--verbose` prints extra diagnostics.
- `--init-board` creates the Trello board, lists, and labels.
- `--full-refresh` clears local project sync state and forces a full refresh.
- `--lss-dry-run` previews journal-driven LSS initiative actions without writes.

## Worktree automation

- Worktrees are managed with `gwq` and stored under `~/ghq` using `host/owner/repo=<number>-<slug>` (slug from GitHub issue/PR title).
- Worktree branch names mirror the path segment (`<number>-<slug>`); if a name collision is detected, `issue-` or `pr-` is prefixed.
- Config lives in the repo at `.config/gwq/config.toml` and is synced to `~/.config/gwq/config.toml`.
- Missing repos are auto-cloned with `ghq` using SSH: `schibsted@schibsted.ghe.com:org/repo.git`.
- Trello list moves trigger actions; `Ready`/`Doing` create or reuse worktrees and `Done` removes them (skipped if dirty).
- Worktree actions run for cards with GitHub issue/PR URLs, or Trello-only cards that match a label mapping in `scripts/wo/config/label-repos.json`.
- LSS-created cards keep their area label and add a repo label only when a `repo-*` frontmatter tag is present; no default `journal` label is added.
- Trello-only cards without a mapped label are skipped (soft), and cards with multiple mapped labels are skipped with an error event.
- When a worktree is created for a trigger list (default: `Ready,Doing`), `wo` first bootstraps an OpenCode session with `opencode run --agent plan --model <resolved-model>` and then initializes a detached tmux session where the right pane runs `opencode -s <sessionId>`.
- `<resolved-model>` comes from `OPENCODE_MODEL` and falls back to `openai/gpt-5.3-codex` when unset.
- Session prompts use `scripts/wo/prompts/review.md` for PRs and `scripts/wo/prompts/issue.md` for issues.
- Trello-only sessions use `scripts/wo/prompts/trello.md`.
- Set `WO_WORKTREE_TRIGGER_LISTS` to customize which lists create/reuse worktrees (default: `Ready,Doing`).
- Set `WO_SESSION_TRIGGER_LISTS` to customize which lists auto-initialize sessions (default: same as `WO_WORKTREE_TRIGGER_LISTS`).
- When a worktree is removed (card moved to `Done`), the corresponding tmux session is also killed if it exists.

## Migration to single-root worktrees

Worktrees now live alongside repos under `~/ghq` using the `repo=branch` naming format.
Run this once after the branch is merged to `main`, not before.

Safe migration steps:

1. Ensure worktrees are clean: `git -C <worktree-path> status`.
2. For each existing worktree under `~/gwq`, move it with git:

   ```bash
   git -C ~/ghq/<host>/<owner>/<repo> worktree move ~/gwq/<host>/<owner>/<repo>/<branch> ~/ghq/<host>/<owner>/<repo>=<branch>
   ```

3. Verify: `git -C ~/ghq/<host>/<owner>/<repo> worktree list`.
4. After verification, remove the old `~/gwq` directory if it is empty.

## Tmux sessionizer

- `scripts/wo/bin/tmux-wo-sessionizer.ts` is a picker for `~/ghq` repos and worktrees.
- Use `--worktree-only` to hide base repos and show only linked worktrees.
- `scripts/tmux-ghq-sessionizer.sh` provides the shell version of the same `~/ghq` picker.
- Entries are rendered as single-line paths (`host › owner › repo › worktree`), so fzf progressively filters as you type.
- Picker ordering emphasizes cycle time: `Doing` worktrees (oldest first), then `Ready` worktrees (oldest first), then other worktrees, then base repos.
- Rows include a fixed-width badge: `[🛠️  <age>]` for `Doing` (cycle-time age), `[⏳  <age>]` for non-`Doing` cards with lead-time data, and `[·   --    ]` when no card timing is available.
- Header shows a `PIT WALL` view for selected labels with throughput, cycle pace, and AW tracked time (`🕒`) for today.
- Default PIT WALL labels are `career,review,business`; override with `WO_SESSIONIZER_PITWALL_LABELS` (comma-separated, lowercase).
- Throughput window in PIT WALL is fixed to the last 7 days.
- AW time uses bucket `aw-watcher-tmux_<hostname>` by default; override with `WO_SESSIONIZER_AW_BUCKET_ID`.
- Run: `npx --yes tsx scripts/wo/bin/tmux-wo-sessionizer.ts`.

## State & idempotency

- JSONL state lives in `scripts/wo/state/` (git-ignored).
- `wo-events.jsonl` stores append-only events.
- `wo-snapshots.jsonl` stores the latest snapshot for conflict resolution.
- Snapshot includes LSS checkbox mirror markers (`lss.byUrl`) for reconciliation.
- Trello wins if a card was moved since the last snapshot.
- Project sync runs incrementally using `updatedAt`, with a daily full refresh.

## Linked PR behavior

- PRs with closing keywords are folded into their issue cards (no separate PR card).
- Issue cards move from Waiting to Ready when any approval or changes requested exists.
- Moves triggered by linked PRs only apply when the card is already in Waiting.
- When a linked PR moves a card to Ready, it is positioned at the top of the list.

## Incremental sync

- Project items are fetched via GraphQL paging (host limit: 100 items per page).
- Uses project item `updatedAt` for incremental runs.
- Cached project metadata TTL: 24 hours.

## Work Session Management

Tracks active time spent in tmux sessions using ActivityWatch, with automatic shutdown ritual when daily limit is reached.

### Components

- Windows ActivityWatch server running on port 5600 (WSL clients connect to it)
- `aw-watcher-tmux` - Sends heartbeats based on active tmux pane
- `wo-session-monitor` - Aggregates time, updates status bar, triggers shutdown

### Systemd services

All services start automatically on login:

```bash
systemctl --user status aw-watcher-tmux wo-session-monitor
```

### Shell aliases

- `wo-status` - Show current session time
- `wo-journal` - Generate and write journal entry
- `wo-journal-dry` - Preview journal without writing
- `wo-services` - Check all service statuses
- `wo-start` - Start all session services
- `wo-stop` - Stop all session services
- `wo-restart` - Restart all session services

### Configuration

Environment variables (set in systemd service or shell):

- `WO_SESSION_LIMIT_MINUTES` - Daily limit (default: 240 = 4h)
- `WO_SESSION_GRACE_MINUTES` - Grace period before forced shutdown (default: 5)
- `WO_SESSION_PROTECTED` - Comma-separated session names to preserve (default: `ghq_gitlab_com_michalmatoga_journal,dotfiles`)
- `AW_PORT` - ActivityWatch server port (default: 5600 in WSL)
- `AW_HOST` - ActivityWatch server host (default: WSL gateway IP; falls back to `localhost`)

Config file at `~/.config/wo/session.json` (symlinked from repo).

### How it works

1. `aw-watcher-tmux` detects the active tmux pane every 30 seconds
2. Sends heartbeats to ActivityWatch with session name, pane path, and command
3. `wo-session-monitor` runs continuously, queries AW for today's events, and aggregates time
4. Status written to `~/.wo/session-status` (displayed in tmux status bar)
5. Monitor state is persisted in `~/.wo/session-monitor-state.json` so extend/grace survives restarts
6. When limit reached: popup offers extend (30m/1h) or shutdown
7. After grace period: kills all non-protected sessions, generates journal entry, then stays paused until the next day
8. At local day rollover the monitor resets itself and resumes tracking automatically

### Early shutdown on demand

- Press `<prefix> + e` in tmux to open a confirmation popup.
- The popup shows the current status from `~/.wo/session-status`.
- Confirming signals `wo-session-monitor.service` directly, which starts the shutdown ritual.

### Journal format

Written to `/home/nixos/ghq/gitlab.com/michalmatoga/journal/YYYY-MM-DD.md`:

```markdown
# 2026-02-17

**Deep work time:** 4h 12m

## Business

**Total:** 2h 30m
Worked mainly on org/repo-a and supporting workflow updates, with most effort going into shipping and validating business-facing changes.

## Growth

**Total:** 1h 27m
Spent time refining the journaling and workflow model, with supporting exploration in org/repo-b.

## Unmapped

**Total:** 15m
Worked on cards that did not have exactly one LSS area label, so their time stayed visible here instead of being guessed.
```

## Reporting

Use `wo-report` to summarize ActivityWatch time and Trello throughput.

```bash
npx --yes tsx scripts/wo/bin/wo-report.ts summary 7
npx --yes tsx scripts/wo/bin/wo-report.ts summary 1
npx --yes tsx scripts/wo/bin/wo-report.ts card <card-id>
npx --yes tsx scripts/wo/bin/wo-report.ts card <card-id> 90
npx --yes tsx scripts/wo/bin/wo-report.ts throughput 14
npx --yes tsx scripts/wo/bin/wo-report.ts chart-data
npx --yes tsx scripts/wo/bin/wo-report.ts chart-data --watch 30
```

Notes:

- Active time comes from ActivityWatch tmux events, mapped to Trello cards via worktree paths.
- Cards without a Trello mapping are grouped under `no-card`.
- `no-card by repo` breaks down unmapped time by repo root (host/owner/repo).
- Labels are current labels at report time (no historical label tracking).
- `chart-data` defaults to all labels currently present on the Trello board (`TRELLO_BOARD_ID_WO`).
- Use `--labels` (or `WO_CHART_LABELS`) only when you want to limit chart series manually.

### Throughput dashboard (Vega-Lite)

- `scripts/wo/site/throughput-dashboard.html` renders cumulative throughput per label from generated JSON.
- Default chart data path: `scripts/wo/state/wo-throughput-chart.json`.
- `chart-data` also maintains cycle-time snapshots in `scripts/wo/state/wo-cycle-time-snapshots.jsonl` (5-minute cadence).
- Dashboard includes:
  - cumulative throughput chart,
  - live gauge of cumulative cycle time across unfinished cards (cards that entered `Doing` and are not `Done`),
  - area chart of 5-minute cycle-time snapshots.
- Generate data once:

  ```bash
  npx --yes tsx scripts/wo/bin/wo-report.ts chart-data
  ```

- Keep chart data fresh while you work (recommended):

  ```bash
  npx --yes tsx scripts/wo/bin/wo-report.ts chart-data --watch 30
  ```

- Optional manual scope override:

  ```bash
  npx --yes tsx scripts/wo/bin/wo-report.ts chart-data --labels career,review,business
  ```

- Serve repo root and open dashboard:

  ```bash
  python -m http.server 4173
  # then open http://localhost:4173/scripts/wo/site/throughput-dashboard.html
  ```

- Dashboard auto-refreshes every 30 seconds by default. Override with query params:
  - `?refresh=10` for 10s refresh cadence.
  - `?data=../state/another-file.json` for custom data path.
  - `?labels=career,review` to preselect visible label series.
  - `?range=this-week&labels=business,household` to combine time range and label selection.
- On this dotfiles setup, `etc/nixos/home.nix` can keep both services always on:
  - `wo-throughput-chart-data.service` regenerates chart JSON continuously.
  - `wo-throughput-dashboard.service` serves the dashboard at `http://127.0.0.1:4173/scripts/wo/site/throughput-dashboard.html`.

### Per-Worktree Summary

| Worktree   | Time   | Commits |
| ---------- | ------ | ------- |
| org/repo-a | 2h 30m | 8       |
| org/repo-b | 1h 42m | 4       |

### Tmux status bar

The status bar shows session time: `2h15m / 4h00m (56%)`

Refresh interval: 15 seconds (tmux default).

## Pane Path Reports

Use the ActivityWatch web UI to create grouped reports for each pane path. In the **Queries** tab:

1. Select the `aw-watcher-tmux_nixos` bucket (it is created automatically).
2. Paste a query like:

```javascript
events = query_bucket("aw-watcher-tmux_nixos");
events = merge_events_by_keys(events, ["app", "pane_path"]);
RETURN = sort_by_duration(events);
```

If you prefer scripts, run `npx --yes tsx scripts/wo/bin/aw-pane-report.ts` to print:

- The total tmux time tracked today
- Each pane path with total duration, event count, and hourly buckets
- A simple textual timeline where `▇` marks active hours

The script uses the same bucket as the UI and is safe to run in WSL (no secrets required).

## Troubleshooting

- Ensure `gh auth login` is configured for `schibsted.ghe.com`.
- Ensure Trello key/token are in `.env`.
- Use `--dry-run --verbose` to inspect actions without side effects.
- If session tracking shows 0m, check `systemctl --user status aw-watcher-tmux` for errors.
- If AW is unreachable, confirm Windows aw-server is running and reachable from WSL on port 5600.
- Tmux watcher requires `TMUX_TMPDIR` to find the socket; this is set automatically by the systemd service.
