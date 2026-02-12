# Workflow Automation (wf)

This directory contains agent-centric workflow automation scripts.

## Operating Model

The workflow is driven by Trello card state changes. A local scheduler polls Trello, detects
state transitions, and triggers workflow stages. The system is cautious by default for side
effects and uses dry-run previews where possible.

### Trello State Model

- Primary signal: list names (preferred) or labels if needed.
- Example states:
  - Backlog
  - Ready
  - In Progress
  - Review
  - Done

### Scheduler Loop

- Runs on a timer (systemd user unit via home-manager).
- Polls Trello every 5 to 15 minutes.
- Detects card state transitions.
- Emits tasks into workflow stages.
- Dedicated hourly job for review requests.

### Guardrails & Visibility

- Dry-run by default for destructive or external actions.
- Auto-run only for safe read-only steps.
- Log actions locally and optionally to Trello comments.
- Produce a daily summary digest.

### Implementation Structure

- `scripts/trello/` Trello API and polling helpers.
- `scripts/agents/` Workflow stages and prompts.
- `scripts/scheduler/` Timer wiring and runners.
- `scripts/wf/` Workflow docs and configuration.

### Configuration Inputs

- Trello board id.
- List-to-state mapping.
- Trigger transitions.
- Polling cadence.
- Safety mode (balanced).

## Review Requests to Trello

Syncs pending GitHub review requests from `schibsted.ghe.com` into Trello as cards in the
`Blocked` list on board `HZ7hcWZy`.

### Behavior

- Pulls open, non-draft PRs where review is requested for `michal-matoga`.
- Creates a Trello card titled `REVIEW: [org/repo] <PR title>`.
- Card description includes the PR URL and PR description.
- Adds labels:
  - `686cbf33add233ccba380f46` (Code Review)
  - `6694db7c23e5de7bec1b7489` (Praca w Schibsted)
- Avoids duplicates by checking all open cards on the board for PR URLs.
- Moves cards to Done when the PR is approved by me.
- Archives cards when the PR is merged without my review.
- After completion (Done or archived), removes AoE sessions/groups and cleans PR/base worktrees.

### Manual Run

```bash
npx --yes tsx scripts/wf/main.ts --dry-run --verbose
npx --yes tsx scripts/wf/main.ts --verbose
npx --yes tsx scripts/wf/main.ts --sessions --dry-run
npx --yes tsx scripts/wf/main.ts --trello --dry-run
```

Flags:

- `--dry-run` prints actions without mutating Trello.
- `--verbose` prints additional diagnostics.
- `--sessions` runs Workflow 2 only (skips Trello).
- `--trello` runs Workflow 1 only (skips sessions).

### Prompts

Default review prompt:

- `scripts/wf/prompts/review.md`

### Entrypoint

- `scripts/wf/main.ts`

## Review Request Workspace + Sessions

When a new review request is detected, the workflow prepares a local workspace and spawns
automation sessions.

### Behavior

- Finds Trello cards with the Code Review label and a PR URL in the description.
- Skips cards that already have a comment containing `opencode -s <sessionId>`.
- Ensures a bare repo exists at `~/g/[GH_HOST]/[org]/[repo].git`.
- Fetches the PR branch into the bare repo.
- Fetches the PR base branch into the bare repo.
- Creates a worktree at `~/g/[GH_HOST]/[org]/[repo]/[pr-<number>]`.
- Creates a worktree for the base branch at `~/g/[GH_HOST]/[org]/[repo]/[base-branch]`.
- Runs opencode review sessions against `main`.
- Creates an AoE session for review management under profile `work` in group `reviews/[org]/[repo]`.
- Adds a Trello comment containing `opencode -s <sessionId>` after both sessions succeed.

### Defaults

- Opencode prompt: `scripts/wf/prompts/review.md`.
- opencode CLI invocation:
  - `opencode run --format json --title "PR<number>: <title>" --share "<prompt>"`.
- AoE CLI command:
  - `aoe add <worktree-path> --title "PR<number>: <title>" --group "reviews/[GH_HOST]/org/repo" --cmd "opencode run --format json --title \"PR<number>: <title>\" --share \"<prompt>\"" --launch`.

## Assigned Issues to Trello

Syncs open GitHub Enterprise issues assigned to me on `schibsted.ghe.com` into Trello as cards
in the `New` list on board `HZ7hcWZy`.

### Behavior

- Pulls open issues assigned to the current user.
- Creates a Trello card in the `New` list for each untracked issue.
- Applies the `6694db7c23e5de7bec1b7489` (Praca w Schibsted) label.
- Avoids duplicates by checking all open cards on the board for issue URLs.
- Archives cards that have the Schibsted label and no longer match active assignments.

### Entrypoint

- `scripts/wf/main.ts`

## Assigned Issues Work Sessions

Creates work sessions for Ready cards with the Schibsted label and an issue URL.

### Behavior

- Filters Trello cards to the Ready (`6689284f81d51c086a80879c`) or Doing (`668928577acb6ab04b723321`) lists.
- Skips cards that already have a comment containing `opencode -s <sessionId>`.
- Ensures a bare repo exists at `~/g/[GH_HOST]/[org]/[repo].git`.
- Creates a worktree at `~/g/[GH_HOST]/[org]/[repo]/issue-<number>`.
- Creates a base worktree at `~/g/[GH_HOST]/[org]/[repo]/main`.
- Runs opencode work sessions with `scripts/wf/prompts/issue.md`.
- Creates an AoE session for work tracking under profile `work` in group `issues/[org]/[repo]`.
- Adds a Trello comment containing `opencode -s <sessionId>` after success.

## Trello-only Tasks Sessions

Creates work sessions from Trello cards without GitHub queries.

### Behavior

- Filters Trello cards in the Ready (`6689284f81d51c086a80879c`) or Doing (`668928577acb6ab04b723321`) lists.
- Requires the `dwp` label (case-sensitive).
- Maps repo labels to clone URLs:
  - `dotfiles` -> `github.com:michalmatoga/dotfiles.git`
  - `Elikonas` -> `github.com:elikonas/elikonas.git`
- Builds a slug from `<repo-label>-<card-title>` (lowercase, dashed, max 80 chars).
- Ensures a bare repo exists at `~/g/github.com/[org]/[repo].git`.
- Creates a worktree at `~/g/github.com/[org]/[repo]/<slug>`.
- Creates a base worktree at `~/g/github.com/[org]/[repo]/<base-branch>`.
- Runs opencode sessions with `scripts/wf/prompts/issue.md`.
- Creates an AoE session under profile `personal` in group `issues/[org]/[repo]`.

### AoE Profiles

- `work`: review and assigned issue sessions.
- `personal`: Trello-only sessions.

Group naming remains unchanged (for example, `reviews/<org>/<repo>` and `issues/<org>/<repo>`).
- Adds a Trello comment containing `opencode -s <sessionId>` after success.

### Required Environment

Loaded from `.env` in the repo root:

- `TRELLO_API_KEY`
- `TRELLO_TOKEN`

### Scheduler

An hourly systemd user timer is declared in `etc/nixos/home.nix`:

- Service: `review-requests-to-trello`
- Timer: `review-requests-to-trello`

To apply via home-manager:

```bash
home-manager switch --flake .#nixos
```

### Logs

```bash
journalctl --user -u review-requests-to-trello.service
journalctl --user -u review-requests-to-trello.service -f
systemctl --user status review-requests-to-trello.service
```
