#!/usr/bin/env bash

set -euo pipefail

require_dotfiles_dir() {
  : "${DOTFILES_DIR:?DOTFILES_DIR is required}"
}

dotfiles_remote_ok() {
  git -C "$1" remote -v | grep -q "git@github.com:michalmatoga/dotfiles.git"
}

resolve_dotfiles_dir() {
  if [ -n "${DOTFILES_DIR:-}" ]; then
    return
  fi

  if [ -d "/etc/nixos" ]; then
    local repo_root
    repo_root=$(git -C /etc/nixos rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$repo_root" ] && dotfiles_remote_ok "$repo_root"; then
      DOTFILES_DIR="$repo_root"
      export DOTFILES_DIR
      return
    fi
  fi

  if command -v ghq >/dev/null 2>&1; then
    local root
    root=$(ghq root)
    local candidate="$root/github.com/michalmatoga/dotfiles"
    if [ -d "$candidate/.git" ] && dotfiles_remote_ok "$candidate"; then
      DOTFILES_DIR="$candidate"
      export DOTFILES_DIR
      return
    fi
  fi
}

resolve_dotfiles_dir
require_dotfiles_dir

if ! [ -d "$DOTFILES_DIR/.git" ]; then
  echo "DOTFILES_DIR is required (not a git repo): $DOTFILES_DIR" >&2
  exit 1
fi

if ! dotfiles_remote_ok "$DOTFILES_DIR"; then
  echo "DOTFILES_DIR is required (dotfiles remote not found)" >&2
  exit 1
fi

if [ -f "$DOTFILES_DIR/.env" ]; then
  # shellcheck disable=SC1090
  . "$DOTFILES_DIR/.env"
elif [ -f "$DOTFILES_DIR/.env.local" ]; then
  # Fall back to .env.local when .env is not present (useful for personal installs)
  # shellcheck disable=SC1090
  . "$DOTFILES_DIR/.env.local"
else
  # No env file found; continue without loading but log a warning
  echo "[wo-run] Warning: no .env or .env.local found in $DOTFILES_DIR — running with current environment"
fi

export PATH="$HOME/.cache/npm/global/bin:$HOME/.nix-profile/bin:$HOME/.local/state/nix/profile/bin:/run/current-system/sw/bin:/etc/profiles/per-user/$USER/bin:$PATH"

cd "$DOTFILES_DIR"

exec npx --yes tsx "$DOTFILES_DIR/scripts/wo/main.ts"
