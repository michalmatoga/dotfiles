#!/usr/bin/env bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
node $DIR/scripts/sync-repos.js
sudo nixos-rebuild switch