#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
notify_script="${script_dir}/../notify.sh"

latest_id=$(gh run list -L 1 --json databaseId -q '.[0].databaseId')
if [ -z "${latest_id}" ]; then
  echo "No runs found" >&2
  exit 1
fi

gh run watch --exit-status "${latest_id}"
status=$?

run_title=$(gh run view "${latest_id}" --json displayTitle -q '.displayTitle')
run_name=$(gh run view "${latest_id}" --json name -q '.name')
run_conclusion=$(gh run view "${latest_id}" --json conclusion -q '.conclusion')
run_url=$(gh run view "${latest_id}" --json url -q '.url')
run_workflow=$(gh run view "${latest_id}" --json workflowName -q '.workflowName')
run_event=$(gh run view "${latest_id}" --json event -q '.event')
run_branch=$(gh run view "${latest_id}" --json headBranch -q '.headBranch')
run_number=$(gh run view "${latest_id}" --json number -q '.number')

if [ -z "${run_title}" ]; then
  run_title="${run_name}"
fi

cwd=$(pwd)
org_repo=$(printf '%s' "${cwd%/}" | awk -F/ '{print $(NF-1) "/" $NF}')
if [ -z "${org_repo}" ]; then
  notify_app="ghwatch"
else
  notify_app="${org_repo}"
fi

case "${run_conclusion}" in
  success)
    conclusion_tag="[OK]"
    ;;
  failure)
    conclusion_tag="[FAIL]"
    ;;
  cancelled)
    conclusion_tag="[CANCELLED]"
    ;;
  skipped)
    conclusion_tag="[SKIPPED]"
    ;;
  *)
    conclusion_tag="[UNKNOWN]"
    ;;
esac

notify_title="${conclusion_tag} ${run_title}"

details=""
if [ -n "${run_workflow}" ]; then
  details="workflow: ${run_workflow}"
fi
if [ -n "${run_event}" ]; then
  details="${details}${details:+ | }event: ${run_event}"
fi
if [ -n "${run_branch}" ]; then
  details="${details}${details:+ | }branch: ${run_branch}"
fi
if [ -n "${run_number}" ]; then
  details="${details}${details:+ | }run: #${run_number}"
fi
if [ -n "${run_url}" ]; then
  details="${details}${details:+ | }${run_url}"
fi

if [ -x "${notify_script}" ]; then
  "${notify_script}" "${notify_app}" "${notify_title}" "${details}" || true
fi

exit "${status}"
