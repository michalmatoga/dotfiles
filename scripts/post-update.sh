#!/usr/bin/env bash

SCRIPTPATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"

cat "$SCRIPTPATH/../.config/whkdrc" > "/mnt/c/Users/micmat/.config/whkdrc"
cat "$SCRIPTPATH/../.config/komorebi.json" > "/mnt/c/Users/micmat/komorebi.json"
cat "$SCRIPTPATH/../.config/alacritty.toml" > "/mnt/c/Users/micmat/AppData/Roaming/alacritty/alacritty.toml"
