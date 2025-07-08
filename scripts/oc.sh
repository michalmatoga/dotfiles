#!/usr/bin/env bash

set -e

DIR=$(dirname "$0")
PROMPT=$(fd -t f . "$DIR/prompts" | fzf --header 'Prompt to use' --tmux)
opencode run "$(cat $PROMPT)"
