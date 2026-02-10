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

- Ensures a bare repo exists at `~/g/[GH_HOST]/[org]/[repo].git`.
- Fetches the PR branch into the bare repo.
- Creates a worktree at `~/g/[GH_HOST]/[org]/[repo]/[pr-<number>]`.
- Runs opencode review sessions against `main`.
- Creates an AoE session for review management.

### Defaults

- Opencode prompt: `scripts/wf/prompts/review.md`.
- opencode CLI invocation:
  - `opencode run --format json --title "Review org/repo#<number>" --share "<prompt>"`.
- AoE CLI command:
  - `aoe add <worktree-path> --title "Review org/repo#<number>" --group "reviews/[GH_HOST]/org/repo" --cmd "opencode run --format json --title \"Review org/repo#<number>\" --share \"<prompt>\"" --launch`.

## Assigned Issues to Trello

Syncs open GitHub Enterprise issues assigned to me on `schibsted.ghe.com` into Trello as cards
in the `New` list on board `HZ7hcWZy`.

### Behavior

- Pulls open issues assigned to the current user.
- Creates a Trello card in the `New` list for each untracked issue.
- Applies the `6694db7c23e5de7bec1b7489` (Praca w Schibsted) label.
- Avoids duplicates by checking all open cards on the board for issue URLs.
- Archives cards that have the Schibsted label and no longer match active assignments.

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
