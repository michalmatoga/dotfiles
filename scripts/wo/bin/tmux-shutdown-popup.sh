#!/usr/bin/env bash
set -euo pipefail

status_file="$HOME/.wo/session-status"
status=$(cat "$status_file" 2>/dev/null || echo ---)

printf 'Work Session Shutdown\n\nStatus: %s\n\n' "$status"
PS3='Select action: '

select choice in "Cancel" "Confirm shutdown"; do
  case "$choice" in
    "Cancel")
      exit 0
      ;;
    "Confirm shutdown")
      if command -v systemctl >/dev/null 2>&1 && systemctl --user kill --signal=USR1 wo-session-monitor.service >/dev/null 2>&1; then
        tmux display-message "Shutdown requested"
      elif command -v pkill >/dev/null 2>&1 && pkill -USR1 -f "scripts/wo/bin/session-monitor.ts" >/dev/null 2>&1; then
        tmux display-message "Shutdown requested"
      else
        tmux display-message "Failed to signal session monitor"
      fi
      exit 0
      ;;
  esac
done
