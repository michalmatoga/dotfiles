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

- Worktrees are managed with `gwq` and stored under `~/gwq` using `host/owner/repo/branch`.
- Config lives in the repo at `.config/gwq/config.toml` and is synced to `~/.config/gwq/config.toml`.
- Missing repos are auto-cloned with `ghq` using SSH: `schibsted@schibsted.ghe.com:org/repo.git`.
- Trello list moves trigger actions; `Doing` creates worktrees and `Done` removes them (skipped if dirty).
- Worktree actions only run for cards with GitHub issue/PR URLs.

## State & idempotency

- JSONL state lives in `scripts/wo/state/` (git-ignored).
- `wf-events.jsonl` stores append-only events.
- `wf-snapshots.jsonl` stores the latest snapshot for conflict resolution.
- Trello wins if a card was moved since the last snapshot.
- Project sync runs incrementally using `updatedAt`, with a daily full refresh.

## Linked PR behavior

- PRs with closing keywords are folded into their issue cards (no separate PR card).
- Issue cards move from Waiting to Ready when any approval or changes requested exists.
- Moves triggered by linked PRs only apply when the card is already in Waiting.
- When a linked PR moves a card to Ready, it is positioned at the top of the list.

## WIP limits

- Ready cap: 5
- Doing cap: 3
- Limits only apply to new cards; existing cards are not auto-moved.

## Incremental sync

- Project items are fetched via GraphQL paging (host limit: 100 items per page).
- Uses project item `updatedAt` for incremental runs.
- Cached project metadata TTL: 24 hours.

## Troubleshooting

- Ensure `gh auth login` is configured for `schibsted.ghe.com`.
- Ensure Trello key/token are in `.env`.
- Use `--dry-run --verbose` to inspect actions without side effects.
