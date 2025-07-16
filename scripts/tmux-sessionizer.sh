#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
  selected=$1
else
  sessions=$(tmux list-sessions -F "#{session_name}" 2>/dev/null)
  all_entries=$(
    fd -d 3 -t d . ~/ghq
  )
  existing_entries=$(echo "$all_entries" | while read -r dir; do
    name=$(basename "$dir" | tr . _)
    if echo "$sessions" | grep -Fxq "$name"; then
      printf "\033[32m* %s\033[0m\n" "$dir"
    fi
  done)
  other_entries=$(echo "$all_entries" | while read -r dir; do
    name=$(basename "$dir" | tr . _)
    if ! echo "$sessions" | grep -Fxq "$name"; then
      printf "  %s\n" "$dir"
    fi
  done)
  selected_entry=$(printf "%s\n%s" "$existing_entries" "$other_entries" | fzf --ansi)
  selected="${selected_entry:2}"
fi

if [[ -z $selected ]]; then
  exit 0
fi

selected_name=$(basename "$selected" | tr . _)
tmux_running=$(pgrep tmux)

if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
  tmux new-session -s $selected_name -c $selected
  tmux split-window -h -t $selected_name
  tmux resize-pane -t $selected_name -x 70
  exit 0
fi

if ! tmux has-session -t=$selected_name 2>/dev/null; then
  tmux new-session -ds $selected_name -c $selected
  tmux send-keys -t $selected_name 'vim' C-m
  tmux split-window -h -t $selected_name -c $selected
  tmux resize-pane -t $selected_name -x 70
fi

if [[ -z $TMUX ]]; then
  tmux attach -t $selected_name
else
  tmux switch-client -t $selected_name
fi
