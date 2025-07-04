#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
  selected=$1
else
  selected=$(find ~/ghq -mindepth 3 -maxdepth 3 -type d | fzf)
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
  tmux split-window -v -t $selected_name -c $selected
  tmux resize-pane -t $selected_name -y 57
fi

if [[ -z $TMUX ]]; then
  tmux attach -t $selected_name
else
  tmux switch-client -t $selected_name
fi
