#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
  selected=$1
else
  existing_sessions=$(
    tmux list-sessions -F "#{pane_current_path}" 2>/dev/null
  )
  existing_sessions_decorated=$(echo "$existing_sessions" | sed 's/^/> /')
  if [[ -n "$existing_sessions" ]]; then
    directories=$(find ~/ghq -mindepth 3 -maxdepth 3 -type d | grep -v -F -f <(echo "$existing_sessions"))
  else
    directories=$(find ~/ghq -mindepth 3 -maxdepth 3 -type d)
  fi
  combined_list=$(printf "%s\n%s" "$existing_sessions_decorated" "$directories" | fzf)
  selected=$combined_list
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
  tmux resize-pane -t $selected_name -y 56
  tmux send-keys -t $selected_name.2 'hg' C-m
fi

if [[ -z $TMUX ]]; then
  tmux attach -t $selected_name
else
  tmux switch-client -t $selected_name
fi
