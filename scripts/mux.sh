#!/usr/bin/env bash

tmuxinator start $(tmuxinator list --newline | fzf)
