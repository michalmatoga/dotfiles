#!/usr/bin/env bash
set -euo pipefail

status_file="$HOME/.wo/session-status"
status=$(cat "$status_file" 2>/dev/null || echo ---)

if ! command -v fzf >/dev/null 2>&1; then
  tmux display-message "fzf not found; cannot show shutdown popup"
  exit 0
fi

choice=$(printf "Cancel\nConfirm shutdown" | fzf --header "Work Session Shutdown - Status: $status" --header-first || true)

if [ "$choice" = "Confirm shutdown" ]; then
  if ! command -v pkill >/dev/null 2>&1; then
    tmux display-message "pkill not found; cannot signal session-monitor"
    exit 0
  fi
  pkill -USR1 -f session-monitor
fi
