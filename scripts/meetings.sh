#!/usr/bin/env bash

set -e

: "${DOTFILES_DIR:?DOTFILES_DIR is required}"
if ! [ -d "$DOTFILES_DIR/.git" ]; then
  echo "DOTFILES_DIR is required (not a git repo): $DOTFILES_DIR" >&2
  exit 1
fi
if ! git -C "$DOTFILES_DIR" remote -v | grep -q "git@github.com:michalmatoga/dotfiles.git"; then
  echo "DOTFILES_DIR is required (dotfiles remote not found): $DOTFILES_DIR" >&2
  exit 1
fi

start=$(date -d "$(echo "" | fzf --print-query --header "start")")
end=$(date -d "$(echo "" | fzf --print-query --header "end")")
echo "$start"
echo "$end"
gcalcli --calendar "michal.matoga@schibsted.com" agenda "$start" "$end" --tsv --details "description" | npx tsx "$DOTFILES_DIR/scripts/cq.ts" | jq '{meetings_h: [.[].duration] | add}'
