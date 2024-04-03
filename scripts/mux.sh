#!/usr/bin/env bash

SELECTED_PROJECT=$(tmuxinator list | fzf)
tmuxinator start $SELECTED_PROJECT
