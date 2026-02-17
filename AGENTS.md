# Repository Agent Handbook

This document orients autonomous agents working inside `michalmatoga/dotfiles`.
Follow these notes before making changes or running commands.

## Essential Context

- Repo is personal NixOS dotfiles plus auxiliary automation scripts (TS, bash).
- Sensitive data lives in `secrets.json`; never print or commit its contents.
- Many workflows depend on external CLIs (`gh`, `gtm`, `opencode`, `pulumi`).
- No Cursor or Copilot rule files are present; this handbook is the source of truth.
- Global git config ignores `AGENTS.md`; leave the file untracked unless requested.

## Environment Setup

- Preferred shell: `zsh` with dotfiles-provided aliases (see `home.nix`).
- Use Nix: run `sudo nixos-rebuild switch` for system and dotfile updates; run in WSL context.
- If flakes are not present, avoid `--flake` and use `sudo nixos-rebuild switch`.
- Home-manager does not use `home-manager switch --flake` in this setup; apply changes with `sudo nixos-rebuild switch` instead.
- `corepack_24` and `nodejs_24` are installed through Nix; no extra Node install.
- Enable direnv if available; `.config/direnv/direnv.toml` sets `load_dotenv = true`.
- `.env` is restored from `secrets.json`; avoid committing generated secrets.
- Ensure `git-crypt` is unlocked (`scripts/init.sh` explains the bootstrap flow).
- `opencode` CLI must be in `$PATH` for review automation in `scripts/review.ts`.

## Build, Lint, Test Commands

- **Nix flake evaluation** (only if `flake.nix` exists): `sudo nixos-rebuild switch --flake .#nixos`.
- **Non-flake rebuild**: `sudo nixos-rebuild switch`.
- **Home-manager reapply only**: do not use `home-manager switch --flake`; reapply via `sudo nixos-rebuild switch`.
- **Node dependencies**: run `npm install --prefix scripts` to restore TS toolchain.
- **TypeScript execution**: `npx --yes tsx scripts/<file>.ts` (use alias when defined).
- **ESLint**: `npx --yes eslint "scripts/**/*.{ts,js}" --max-warnings=0`.
- **Prettier formatting**: `npx --yes prettier --check "scripts/**/*.{ts,js,json}"`.
- **Markdown lint**: `npx --yes markdownlint-cli2 "**/*.md" --config .config/markdownlintrc.json`.
- **Shell lint (optional)**: use `shellcheck scripts/*.sh scripts/**/*.sh` if installed.
- **Nix formatting**: `nix fmt` (requires `nix` ≥ 2.20) or `nixpkgs-fmt etc/nixos/*.nix`.
- **Single script / smoke test**: `npx --yes tsx scripts/hg/hg.ts -- <args>` (substitute file).
- No dedicated unit tests exist; validate behavior by running the relevant script.

## Running Single Tests or Scripts

- Pick the script closest to the change (e.g., `scripts/git-add-ref.ts`).
- Execute with `npx --yes tsx path/to/script.ts [flags]` to ensure type transpilation.
- For bash utilities use `bash scripts/<name>.sh`; ensure `chmod +x` if adding new files.
- Long-running monitors (`hg.ts`, `review.ts`) expect API tokens; set env vars before run.
- To dry-run Trello integrations, pass `--dry-run` if you add such a flag; default scripts mutate real data.
- For GitHub queries, set `GH_USER` and `GH_HOST` (defaults provided in `review.ts`).

## General Coding Principles

- Follow `.config/.editorconfig`: UTF-8, spaces, 2-space indentation, trim trailing whitespace.
- Keep files UNIX-formatted with final newline; Markdown (MD013) line length is relaxed.
- Avoid committing generated artifacts (`dist/`, secrets); respect `.config/git/gitignore-global`.
- Document non-obvious shell pipelines inline; avoid redundant comments elsewhere.
- Prefer explicit errors over silent failures; propagate `Error` objects with context.

## TypeScript & JavaScript Guidelines

- Use ECMAScript modules with Node built-in imports prefixed by `node:` (see `scripts/review.ts`).
- Order imports: Node built-ins, third-party, local modules; keep blank line between groups.
- Prefer `const` for bindings; fall back to `let` only when reassignment is necessary.
- Define top-level `type` aliases for structured data (`PullRequest`, `RepositoryInfo`).
- Wrap script entrypoints in `(async function main() { ... })();` for clarity and `await` usage.
- Leverage `async/await`; keep promise chains minimal and handle rejections with `try/catch`.
- Provide user-facing errors with actionable hints (for example, `gh auth login`).
- Sanitize external CLI output (see `stripAnsi` pattern) before parsing/logging.
- Use template literals for log messages; avoid string concatenation when readability suffers.
- For CLI args, parse once (`process.argv.slice(2)`) and reuse; avoid repeated slicing.
- Guard optional data with nullish checks before access; never assume external API shape.
- Export shared helpers from `scripts/hg/lib/*` for reuse rather than duplicating logic.
- Keep functions pure when possible; isolate side effects (I/O, exec) in small helpers.
- Prefer `Set`/`Map` when tracking unique IDs (`seen` example in `review.ts`).
- Validate JSON parsing with try/catch and convert unknown errors via `String(error)`.
- Format CLI arguments via helper (`formatArgs`) before logging to preserve quoting.
- CLI scripts should exit gracefully on signals; register `SIGINT`/`SIGTERM` handlers.
- Avoid default exports; use named exports to simplify tree-shaking and reuse.
- When fetching secrets, load from `secrets.json` once at module scope; do not mutate the object.

## Shell Script Guidelines

- Start new shell scripts with `#!/usr/bin/env bash` and enable safety flags when practical (`set -euo pipefail`).
- Use double quotes around variable expansions that may contain spaces (`"$CHECKOUT_PATH"`).
- Prefer long-form commands over aliases inside scripts to avoid user-specific dependencies.
- Document external dependencies at top comments (Bitwarden, git-crypt, etc.).
- Avoid hardcoding personal paths unless required; when necessary, centralize in variables.
- Use subshells for complex pipelines to keep global state clean.
- Capture command output with `$(...)` instead of backticks unless quoting demands otherwise.
- For interactive utilities (fzf, gtm) warn agents before running—they may stall automation.

## Nix Configuration Notes

- Flake entry `.#nixos` composes overlays adding `gogcli`; do not rename unless updating overlays.
- Keep overlays in `etc/nixos/flake.nix`; prefer small helper files (see `gogcli.nix`).
- `home.nix` imports alias modules (`./aliases/git.nix`); extend via additional files to stay modular.
- Ensure new packages live in `home.packages`; use `with pkgs;` and keep alphabetical order when adding.
- When updating channels, follow README instructions (`sudo nix-channel --update`).
- For WSL tweaks, review `configuration.nix` before altering system-level options.
- Use `nix fmt` prior to commit when editing `.nix` files to maintain consistent formatting.

## Markdown and Documentation

- Markdown lint config at `.config/markdownlintrc.json` relaxes heading duplicates and inline HTML.
- Use ATX headings; maintain consistent heading levels (`MD003`).
- Allow long lines for URLs; do not forcibly wrap long shell commands.
- When adding docs describing secrets, omit actual values; reference `secrets.json` fields instead.

## Git Hygiene

- Repo-level git config enforces GPG signing; avoid bypassing unless absolutely required.
- Respect global ignore list (`tmp.md`, `.gtm/`, `AGENTS.md`); do not re-add without intent.
- Commit messages should favor imperative mood and explain rationale, not just the change.
- Use `npx tsx scripts/git-add-ref.ts <file>` to append Trello references before commit, if needed.
- Never force push to protected remotes without confirmation from repository owner.

## Secrets and Credentials

- Never print Bitwarden output or decrypted keys into logs.
- `scripts/init.sh` expects Bitwarden CLI `bw` and GPG; ensure both are available before running.
- SSH keys are materialized into `~/.ssh`; clean up temporary files if scripts fail midway.
- `secrets.json` stores base64 blobs for `.env`, kubeconfig, and Trello tokens—treat as highly sensitive.
- Remove debug logging that could leak Trello URLs or tokens before submitting patches.

## Automation Prompts and Review Bots

- `scripts/prompts/commit-review.md` and `pr-review.md` guide review bots; keep instructions aligned.
- `scripts/review.ts` spins up Opencode sessions; maintain compatibility with `opencode --format json`.
- When modifying review automation, log actionable hints for missing dependencies (`gh`, `opencode`).
- Store additional prompts beside existing ones in `scripts/prompts/` for discoverability.

## Troubleshooting Tips

- If `gh` commands fail, run `gh auth login` and verify `GH_HOST` matches your enterprise host.
- `git-crypt unlock` requires imported GPG keys; see `scripts/init.sh` for the full bootstrap pipeline.
- Trello API errors often stem from expired tokens—refresh via Bitwarden and `secrets.json` update.
- `npx tsx` caches in `scripts/node_modules`; delete and reinstall if TypeScript types go stale.
- Nix flake build issues may require updating `flake.lock`; run `nix flake update` cautiously.

## Key Scripts Overview

- `scripts/review.ts`: polls GitHub review queues and opens Opencode sessions automatically.
- `scripts/git-add-ref.ts`: stamps git trailers with Trello or GH Enterprise references via API calls.
- `scripts/hg/hg.ts`: dashboard for hourglass tracking; requires CSV exports and Trello tokens.
- `scripts/hg/lib/*`: shared helpers for CSV parsing, GTM metrics, timing math, Trello lookups.
- `scripts/timebox.ts`: orchestrates focused work intervals; respect existing logging patterns.
- `scripts/update-npm-deps.ts`: updates dependency ranges; run `npm install --prefix scripts` afterward.
- `scripts/pulumi.sh`: wraps Pulumi operations; ensure `PULUMI_CWD` env is set before execution.
- `scripts/sync-ghec.ts`: synchronizes GitHub Enterprise Cloud repos; needs `gh auth login`.
- `scripts/shutdown.ts` and `scripts/startup.ts`: manage daily rituals; emit console summaries only.
- `scripts/gr.sh`: triggers Git Time Metric reports; avoid changing report formats without approval.
- `scripts/init.sh`: bootstrap script with destructive steps; never edit without explicit confirmation.
- `scripts/prompts/*.md`: prompt templates consumed by automation; keep instructions concise and atomic.

## Work Orchestration (wo) Scripts

- `scripts/wo/main.ts`: orchestrates Trello/GitHub sync use-cases.
- `scripts/wo/bin/tmux-wo-sessionizer.ts`: fzf picker for worktrees and repos.
- `scripts/wo/bin/aw-watcher-tmux.ts`: sends tmux activity heartbeats to ActivityWatch.
- `scripts/wo/bin/session-monitor.ts`: aggregates session time, triggers shutdown ritual.
- `scripts/wo/bin/aw-pane-report.ts`: exports pane-path summary + timeline from ActivityWatch.
- `scripts/wo/bin/journal-write.ts`: generates hourly commit breakdown for journal.
- `scripts/wo/lib/sessions/activitywatch.ts`: REST client for ActivityWatch API.
- `scripts/wo/lib/sessions/journal.ts`: journal formatting helpers.
- `scripts/wo/lib/sessions/tmux.ts`: tmux session management for worktrees.

## Systemd User Services

- `aw-server`: ActivityWatch server on port 5601 for tmux tracking.
- `aw-watcher-tmux`: sends heartbeats based on active tmux pane (depends on aw-server).
- `wo-session-monitor`: monitors time, updates status bar, triggers shutdown at limit.
- `wo-sync`: runs `wo` sync every 5 minutes via timer.
- `copilot-ghe-refresh`: refreshes Copilot GHE token every 20 minutes.

Use `systemctl --user status <service>` to check; `wo-start`/`wo-stop` aliases manage session services.

## Pre-Commit Checklist for Agents

- Run relevant formatters (`eslint`, `prettier`, `nix fmt`, `markdownlint`) for touched files.
- Execute affected scripts manually to validate behavior (no automated tests exist yet).
- Confirm secrets are untouched and no debug logs leak sensitive data.
- Update documentation when behavior or dependencies change.
- Summarize key risks or manual steps in commit message body if applicable.

## When in Doubt

- Prefer conservative changes; this is a personal workstation repo with side effects.
- Ask for confirmation before altering provisioning scripts (`init.sh`, `configuration.nix`).
- Keep improvements incremental; large refactors should be coordinated with repo owner.
- Document any new workflow so future agents can follow your precedent.

## Operational reminders

- The controller may signal a plan→build mode change; at that point you can run commands and edit files, but act with precision.
- Never auto-commit or auto-push; wait for explicit user acknowledgement before creating commits or pushing.
