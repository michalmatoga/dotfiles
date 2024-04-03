#!/usr/bin/env bash

SELECTED_PROJECT=$(tmuxinator list | awk '{print $1}' | fzf)
tmuxinator start $SELECTED_PROJECT
