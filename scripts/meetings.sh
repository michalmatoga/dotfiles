#!/usr/bin/env bash

set -e

start=$(date -d "$(echo "" | fzf --print-query --header "start")")
end=$(date -d "$(echo "" | fzf --print-query --header "end")")
echo "$start"
echo "$end"
gcalcli --calendar "michal.matoga@schibsted.com" agenda "$start" "$end" --tsv --details "description" | npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/cq.ts | jq '{meetings_h: [.[].duration] | add}'
