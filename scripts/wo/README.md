# Workflow Orchestration (wo)

New workflow system based on the use-case pattern. It syncs assigned work and review requests
from GitHub Enterprise into a unified Trello board, and pushes Trello list moves back to GitHub
for Schibsted-labeled cards.

## What it does

- Pulls assigned items from `svp` Project #5 and creates/updates Trello cards.
- Pulls GitHub review requests and creates/updates Trello cards.
- Moves Trello list changes back to GitHub project status (only for `schibsted` label).
- Auto-moves review cards to Done once you approve the PR.

## Use-case layout

- `scripts/wo/main.ts` runs the use-cases in order.
- `scripts/wo/use-cases/*` are the high-level flow descriptions (flat, readable steps).
- `scripts/wo/lib/*` holds adapters (Trello/GitHub), policy, sync logic, and state.

## Trello board model

Lists:

- Inbox
- Triage
- Ready
- Doing
- Waiting
- Done

Labels (lowercase):

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

## Worktree automation

- Worktrees are managed with `gwq` and stored under `~/gwq` using `host/owner/repo/<number>-<slug>` (slug from GitHub issue/PR title).
- Worktree branch names mirror the path segment (`<number>-<slug>`); if a name collision is detected, `issue-` or `pr-` is prefixed.
- Config lives in the repo at `.config/gwq/config.toml` and is synced to `~/.config/gwq/config.toml`.
- Missing repos are auto-cloned with `ghq` using SSH: `schibsted@schibsted.ghe.com:org/repo.git`.
- Trello list moves trigger actions; `Doing` creates worktrees and `Done` removes them (skipped if dirty).
- Worktree actions only run for cards with GitHub issue/PR URLs.
- When a worktree is created for `Doing`, a detached tmux session is initialized and the right pane runs `opencode -s <sessionId>`.
- Session prompts use `scripts/wo/prompts/review.md` for PRs and `scripts/wo/prompts/issue.md` for issues.
- Set `WO_SESSION_TRIGGER_LISTS` to customize which lists auto-initialize sessions (default: `Doing`).
- When a worktree is removed (card moved to `Done`), the corresponding tmux session is also killed if it exists.

## Tmux sessionizer

- `scripts/wo/bin/tmux-wo-sessionizer.ts` is a picker for `~/gwq` worktrees and `~/ghq` repos.
- Entries are rendered as single-line paths (`host › owner › repo › worktree`), so fzf progressively filters as you type.
- Worktree entries include a status dot: `●` = opencode active, `○` = opencode idle/unknown (derived from last 5 log files in `~/.local/share/opencode/log/`, mapping sessions to worktrees via `opencode db`, with running tmux opencode panes treated as active if no idle signal is found).
- Run: `npx --yes tsx scripts/wo/bin/tmux-wo-sessionizer.ts`.

## State & idempotency

- JSONL state lives in `scripts/wo/state/` (git-ignored).
- `wo-events.jsonl` stores append-only events.
- `wo-snapshots.jsonl` stores the latest snapshot for conflict resolution.
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

- `aw-server-rust` - ActivityWatch server running on port 5601 (separate from Windows AW)
- `aw-watcher-tmux` - Sends heartbeats based on active tmux pane
- `wo-session-monitor` - Aggregates time, updates status bar, triggers shutdown

### Systemd services

All services start automatically on login:

```bash
systemctl --user status aw-server aw-watcher-tmux wo-session-monitor
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
- `WO_SESSION_PROTECTED` - Comma-separated session names to preserve (default: `journal,dotfiles`)
- `AW_PORT` - ActivityWatch server port (default: 5601)

Config file at `~/.config/wo/session.json` (symlinked from repo).

### How it works

1. `aw-watcher-tmux` detects the active tmux pane every 30 seconds
2. Sends heartbeats to ActivityWatch with session name, pane path, and command
3. `wo-session-monitor` queries AW for today's events and aggregates time
4. Status written to `~/.wo/session-status` (displayed in tmux status bar)
5. When limit reached: popup offers extend (30m/1h) or shutdown
6. After grace period: kills all non-protected sessions, generates journal entry

### Early shutdown on demand

- Press `<prefix> + e` in tmux to open a confirmation popup.
- The popup shows the current status from `~/.wo/session-status`.
- Confirming sends a signal to `wo-session-monitor`, which starts the shutdown ritual.

### Journal format

Written to `/home/nixos/ghq/gitlab.com/michalmatoga/journal/YYYY-MM-DD.md`:

```markdown
## Work Session - 2026-02-17

**Total active time:** 4h 12m

### Session Narrative

Focused on org/repo-a and shipped several updates, with supporting exploration in org/repo-b.
Shifted into investigation and validation work later in the day without new shipped updates.

### Per-Worktree Summary

| Worktree   | Time   | Commits |
| ---------- | ------ | ------- |
| org/repo-a | 2h 30m | 8       |
| org/repo-b | 1h 42m | 4       |
```

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
- If AW server fails with "poisoned lock", restart: `systemctl --user restart aw-server`.
- Tmux watcher requires `TMUX_TMPDIR` to find the socket; this is set automatically by the systemd service.
