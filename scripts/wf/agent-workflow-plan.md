# Agent-Centric Workflow Plan (Trello-Driven)

## Goals

- Faster routine tasks
- Higher quality output
- Better visibility
- Safer changes (balanced caution)
- Cross-tool orchestration

## Operating Model

The workflow is driven by Trello card state changes. A local scheduler polls Trello, detects
state transitions, and triggers agent stages. The system is cautious by default for side effects
and uses dry-run previews where possible.

## Trello State Model

- Primary signal: list names (preferred) or labels if needed
- Example states:
  - Backlog
  - Ready
  - In Progress
  - Review
  - Done
- Automation triggers:
  - Entering Ready
  - Entering In Progress

## Scheduler Loop (Local)

- Runs on a timer (systemd user unit via home-manager)
- Polls Trello every 5 to 15 minutes
- Detects card state transitions
- Emits tasks into the agent workflow
- Dedicated hourly job for code review requests

## Agent Workflow Stages

1. Triage Stage
   - Summarize new cards
   - Propose labels or priority
   - Flag missing info or unclear scope

2. Daily Ritual Stage
   - Compile a Today list
   - Propose timeboxes
   - Update Trello with short status notes

3. Code-Change Stage
   - Create or suggest branch name
   - Gather context and draft task plan
   - Propose edits with a dry-run preview
   - Run relevant checks when safe

## Guardrails & Visibility

- Dry-run by default for destructive or external actions
- Auto-run only for safe read-only steps
- Log actions locally and optionally to Trello comments
- Produce a daily summary digest

## Implementation Structure

- scripts/trello/ Trello API and polling helpers
- scripts/agents/ Workflow stages and prompts
- scripts/scheduler/ Timer wiring and runners
- scripts/wf/ Workflow docs and configuration

## Configuration Inputs

- Trello board id
- List-to-state mapping
- Trigger transitions
- Polling cadence
- Safety mode (balanced)

## Workflow 1: Code Review Requests to Trello

### Purpose

Detect new code review requests assigned to me on `schibsted.ghe.com` and create Trello cards
in the `Blocked` list on board `HZ7hcWZy`.

### Trigger

- Hourly scheduler job
- Manual trigger via CLI

### Inputs

- GitHub Enterprise host: `schibsted.ghe.com`
- Assignee: current user
- Trello board: `HZ7hcWZy`
- Trello list: `Blocked`
- Trello list id: `68d38cb24e504757ecc2d19a` (Blocked)
- Trello label id: `686cbf33add233ccba380f46` (Code Review)
- Trello label id: `6694db7c23e5de7bec1b7489` (Praca w Schibsted)

### Implementation Notes

- Script in TypeScript under `scripts/wf/`.
- Invoked via `npx --yes tsx scripts/wf/<script>.ts`.
- Trello credentials loaded from `.env`.
- GitHub operations performed through `gh` CLI.
- Trello env vars: `TRELLO_API_KEY`, `TRELLO_TOKEN`.
- Manual trigger flags: `--dry-run`, `--verbose`.

### Actions

1. Query pending review requests assigned to me on `schibsted.ghe.com`.
2. For each new request not already tracked, create a Trello card in `Blocked`.
3. Check all open cards on the board for the PR URL to avoid duplicates.
4. On every loop, check existing cards against active review requests; archive obsolete cards.

### Guardrails

- Read-only checks against GitHub and Trello before creating cards.
- Do not create a card if any open board card already references the PR URL.
- Archive only cards with the Code Review label.

### Visibility

- Log created cards locally.
- Optional: add a comment on the Trello card with the PR URL and title.

### Definitions

- Active review request: review is pending and the PR is not closed.
- Exclude draft PRs from review requests.
- Card title format: `REVIEW: [org/repo] <original PR title>`.
- Card labels: include `686cbf33add233ccba380f46` (Code Review).
- Card labels: also include `6694db7c23e5de7bec1b7489` (Praca w Schibsted).
- Card description: include a link to the PR and the PR description.
- Archive sweep scope: all lists on the board.
