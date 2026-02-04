#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
  selected=$1
else
  declare -A session_map
  while IFS= read -r session_name; do
    [[ -n $session_name ]] && session_map["$session_name"]=1
  done < <(tmux list-sessions -F "#{session_name}" 2>/dev/null || true)

  mapfile -t all_entries < <(fd -d 3 -t d . ~/ghq 2>/dev/null)

  existing_entries=()
  other_entries=()

  for dir in "${all_entries[@]}"; do
    [[ -z $dir ]] && continue
    name=$(basename "$dir" | tr . _)
    if [[ -n ${session_map["$name"]} ]]; then
      display=$'\033[32m* '$dir$'\033[0m'
      existing_entries+=("${display}	${dir}")
    else
      other_entries+=("  ${dir}	${dir}")
    fi
  done

  fzf_input=("${existing_entries[@]}" "${other_entries[@]}")
  selected_entry=$(printf '%s\n' "${fzf_input[@]}" | fzf --ansi --delimiter=$'\t' --with-nth=1)
  if [[ -z $selected_entry ]]; then
    exit 0
  fi

  IFS=$'\t' read -r _ selected <<<"$selected_entry"
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
