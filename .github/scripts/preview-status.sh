#!/usr/bin/env bash
# Reports the preview stage through GitHub's Deployments API. A `success`
# status renders as a "View deployment" entry in the PR timeline: visible on
# the PR, but unlike a comment it sends no notification email to anyone.
# `deployed` creates one deployment for the stage (marked transient — these
# are throwaway environments) and marks it success with the web Worker as its
# URL; `destroyed` marks the stage's deployments inactive once the stage is
# gone. Needs GH_TOKEN with deployments: write, ALCHEMY_STAGE, and — for
# `deployed` — GIT_COMMIT_SHA and WEB_URL from preview-urls.sh.
set -euo pipefail

mode="$1"
base="repos/$GITHUB_REPOSITORY/deployments"

case "$mode" in
  deployed)
    log_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
    # required_contexts is emptied: contexts like this very workflow are still
    # running, and waiting on them would 409 the creation. auto_merge is off
    # because the exact head SHA is what got deployed.
    deployment_id="$(
      gh api --method POST "$base" --input - --jq .id <<JSON
{"ref": "$GIT_COMMIT_SHA", "environment": "$ALCHEMY_STAGE", "transient_environment": true, "production_environment": false, "auto_merge": false, "required_contexts": []}
JSON
    )"
    gh api --method POST "$base/$deployment_id/statuses" \
      -f state=success \
      -f environment_url="$WEB_URL" \
      -f log_url="$log_url" \
      -f description='Preview stage deployed' > /dev/null
    echo "Marked deployment $deployment_id ($ALCHEMY_STAGE) as success"
    ;;
  destroyed)
    # One deployment per push, all for a stage that no longer exists.
    gh api --paginate "$base?environment=$ALCHEMY_STAGE" --jq '.[].id' |
      while read -r id; do
        gh api --method POST "$base/$id/statuses" \
          -f state=inactive \
          -f description='Stage destroyed' > /dev/null
        echo "Marked deployment $id ($ALCHEMY_STAGE) as inactive"
      done
    ;;
  *)
    echo "usage: $0 <deployed|destroyed>" >&2
    exit 64
    ;;
esac
