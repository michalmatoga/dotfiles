# Workflow Automation (wf)

This directory contains agent-centric workflow automation scripts.

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
- Archives obsolete cards that have the Code Review label and no longer match active reviews.

### Manual Run

```bash
npx --yes tsx scripts/wf/review-requests.ts --dry-run --verbose
npx --yes tsx scripts/wf/review-requests.ts --verbose
```

Flags:

- `--dry-run` prints actions without mutating Trello.
- `--verbose` prints additional diagnostics.

### Prompts

Default review prompt:
- `scripts/wf/prompts/review.md`

### Workflow Docs

- `scripts/wf/agent-workflow-plan.md`

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
