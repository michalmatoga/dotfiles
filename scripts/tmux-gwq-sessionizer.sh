#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
  selected=$1
else
  declare -A session_map
  while IFS= read -r session_name; do
    [[ -n $session_name ]] && session_map["$session_name"]=1
  done < <(tmux list-sessions -F "#{session_name}" 2>/dev/null || true)

  mapfile -t gwq_entries < <(fd -d 4 -t d . ~/gwq 2>/dev/null)
  mapfile -t ghq_entries < <(fd -d 3 -t d . ~/ghq 2>/dev/null)

  existing_entries=()
  other_entries=()

  format_entry() {
    local tag=$1
    local dir=$2
    local name=${dir#"$HOME/"}
    name=$(printf "%s" "$name" | tr '/.' '__')
    if [[ -n ${session_map["$name"]} ]]; then
      display=$'\033[32m*\033[0m '
      display+="$tag $dir"
      existing_entries+=("${display}"$'\t'"${dir}")
    else
      other_entries+=("  $tag $dir"$'\t'"${dir}")
    fi
  }

  for dir in "${gwq_entries[@]}"; do
    [[ -z $dir ]] && continue
    format_entry "[wt]" "$dir"
  done

  for dir in "${ghq_entries[@]}"; do
    [[ -z $dir ]] && continue
    format_entry "[repo]" "$dir"
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

selected_name=${selected#"$HOME/"}
selected_name=$(printf "%s" "$selected_name" | tr '/.' '__')
tmux_running=$(pgrep tmux)

if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
  tmux new-session -s "$selected_name" -c "$selected"
  tmux split-window -h -t "$selected_name"
  tmux resize-pane -t "$selected_name" -x 70
  exit 0
fi

if ! tmux has-session -t="$selected_name" 2>/dev/null; then
  tmux new-session -ds "$selected_name" -c "$selected"
  tmux send-keys -t "$selected_name" 'vim' C-m
  tmux split-window -h -t "$selected_name" -c "$selected"
  tmux resize-pane -t "$selected_name" -x 70
fi

if [[ -z $TMUX ]]; then
  tmux attach -t "$selected_name"
else
  tmux switch-client -t "$selected_name"
fi
