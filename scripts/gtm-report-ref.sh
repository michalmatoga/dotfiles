#!/usr/bin/env bash

# Initialize variables for since, until, and grep_id
since=""
until=""
grep_id=""

# Extract the ID from the first argument (Trello or GitHub Enterprise URL)
if [[ "$#" -gt 0 ]]; then
  if [[ $1 =~ ^https://trello.com/c/([a-zA-Z0-9]+)/ ]]; then
    grep_id="${BASH_REMATCH[1]}"
  elif [[ $1 =~ ^https://[^/]+/[^/]+/[^/]+/issues/([0-9]+) ]]; then
    grep_id="${BASH_REMATCH[1]}"
  else
    echo "Invalid URL: $1"
    exit 1
  fi
  shift
else
  echo "A Trello or GitHub Enterprise URL is required as the first argument."
  exit 1
fi

# Parse remaining command-line arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
  --since)
    since="$2"
    shift
    ;;
  --until)
    until="$2"
    shift
    ;;
  *)
    echo "Unknown parameter passed: $1"
    exit 1
    ;;
  esac
  shift
done

# Construct the git log command
git_command="git log --grep '$grep_id' --pretty=%H"

# Add since and until if they are set
if [[ -n "$since" ]]; then
  git_command+=" --since='$since'"
fi
if [[ -n "$until" ]]; then
  git_command+=" --until='$until'"
fi

# Execute the command and pipe to gtm report
eval "$git_command" | gtm report
