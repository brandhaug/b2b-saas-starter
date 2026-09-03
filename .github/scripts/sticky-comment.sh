#!/usr/bin/env bash
# Posts one PR comment per marker and edits it on later runs instead of adding
# another. Usage: sticky-comment.sh <pr number> <body file>. The body file must
# start with the marker line `<!-- preview-deploy-comment -->`. Needs GH_TOKEN
# with pull-requests: write and GITHUB_REPOSITORY.
set -euo pipefail

pr="$1"
body_file="$2"
marker='<!-- preview-deploy-comment -->'

existing="$(
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments" \
    --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1
)"

if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" \
    -F "body=@$body_file" > /dev/null
  echo "Updated comment $existing on #$pr"
else
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$pr/comments" \
    -F "body=@$body_file" > /dev/null
  echo "Created comment on #$pr"
fi
