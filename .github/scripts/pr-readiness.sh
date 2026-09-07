#!/usr/bin/env bash
set -u

# Read-only, single-sample PR gate. A `skipping` bucket is accepted because
# GitHub reports an explicitly skipped required check as satisfied; an empty
# or unknown bucket is never treated as success.

usage() {
  printf 'usage: %s <pr-number-or-url> [expected-head-sha]\n' "$0" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 1
fi

pr=$1
expected_sha=${2-}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/pr-readiness.XXXXXX") || exit 1
trap 'rm -rf "$tmp_dir"' EXIT

meta_before=$tmp_dir/meta-before.json
meta_after=$tmp_dir/meta-after.json
checks_file=$tmp_dir/checks.json
error_file=$tmp_dir/gh.err
fields='headRefOid,state,isDraft,mergeable,mergeStateStatus,reviewDecision,url'

emit() {
  state=$1
  shift
  sha=${head_sha-}
  url=${pr_url-}
  if [ "$#" -eq 0 ]; then
    reasons='[]'
  else
    reasons=$(printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0))') || exit 1
  fi
  checks='[]'
  if [ -s "$checks_file" ] && jq -e 'type == "array"' "$checks_file" >/dev/null 2>&1; then
    checks=$(cat "$checks_file")
  fi
  jq -cn --arg state "$state" --arg sha "$sha" --arg url "$url" \
    --argjson reasons "$reasons" --argjson checks "$checks" \
    --arg prState "${pr_state-}" --arg isDraft "${is_draft-}" \
    --arg mergeable "${mergeable-}" --arg mergeState "${merge_state-}" \
    --arg reviewDecision "${review_decision-}" \
    '{state:$state,headSha:$sha,url:$url,reasons:$reasons,checks:$checks,
      metadata:{state:$prState,isDraft:($isDraft == "true"),mergeable:$mergeable,
        mergeStateStatus:$mergeState,reviewDecision:$reviewDecision}}'
}

if ! gh pr view "$pr" --json "$fields" >"$meta_before" 2>"$error_file"; then
  emit blocked 'unable to read pull request metadata'
  exit 1
fi

if ! jq -e 'type == "object" and
  (.headRefOid | type == "string" and length > 0) and
  (.state | type == "string" and length > 0) and
  (.isDraft | type == "boolean") and
  (.mergeable | type == "string" and length > 0) and
  (.mergeStateStatus | type == "string" and length > 0) and
  (.reviewDecision | type == "string") and
  (.url | type == "string" and length > 0)' \
  "$meta_before" >/dev/null 2>&1; then
  emit blocked 'pull request metadata is incomplete or invalid'
  exit 1
fi

head_sha=$(jq -r '.headRefOid' "$meta_before")
pr_state=$(jq -r '.state' "$meta_before")
is_draft=$(jq -r '.isDraft' "$meta_before")
mergeable=$(jq -r '.mergeable' "$meta_before")
merge_state=$(jq -r '.mergeStateStatus' "$meta_before")
review_decision=$(jq -r '.reviewDecision' "$meta_before")
pr_url=$(jq -r '.url' "$meta_before")

if [ -n "$expected_sha" ] && [ "$head_sha" != "$expected_sha" ]; then
  emit blocked 'expected head SHA does not match'
  exit 1
fi

set +e
gh pr checks "$pr" --required --json name,bucket,link,state >"$checks_file" 2>"$error_file"
checks_exit=$?
set -e

# gh uses exit 8 for pending checks and may use a non-zero status for other
# check failures; the JSON remains authoritative when it is well-formed.
if ! jq -e 'type == "array" and length > 0 and all(.[];
  type == "object" and
  (.name != null and (.name | type) == "string" and (.name | length) > 0) and
  (.bucket != null and (.bucket | type) == "string" and (.bucket | length) > 0) and
  (.state != null and (.state | type) == "string" and (.state | length) > 0))' \
  "$checks_file" >/dev/null 2>&1; then
  emit blocked 'required checks are absent or incomplete'
  exit 1
fi

if ! gh pr view "$pr" --json "$fields" >"$meta_after" 2>"$error_file"; then
  emit blocked 'unable to verify pull request head'
  exit 1
fi
if ! jq -e 'type == "object" and
  (.headRefOid | type == "string" and length > 0) and
  (.state | type == "string" and length > 0) and
  (.isDraft | type == "boolean") and
  (.mergeable | type == "string" and length > 0) and
  (.mergeStateStatus | type == "string" and length > 0) and
  (.reviewDecision | type == "string") and
  (.url | type == "string" and length > 0)' \
  "$meta_after" >/dev/null 2>&1; then
  emit blocked 'pull request metadata is incomplete or invalid'
  exit 1
fi
head_after=$(jq -r '.headRefOid' "$meta_after")
if [ "$head_after" != "$head_sha" ]; then
  emit blocked 'pull request head changed during readiness check'
  exit 1
fi

# All readiness fields come from this post-check sample. The first sample is
# only used to detect a head change and to reject an early expected-SHA miss.
head_sha=$head_after
pr_state=$(jq -r '.state' "$meta_after")
is_draft=$(jq -r '.isDraft' "$meta_after")
mergeable=$(jq -r '.mergeable' "$meta_after")
merge_state=$(jq -r '.mergeStateStatus' "$meta_after")
review_decision=$(jq -r '.reviewDecision' "$meta_after")
pr_url=$(jq -r '.url' "$meta_after")

reasons=()
[ "$is_draft" = true ] && reasons+=("pull request is a draft")
[ "$pr_state" != OPEN ] && reasons+=("pull request is not open")
[ "$mergeable" = CONFLICTING ] && reasons+=("pull request has conflicts")
[ "$merge_state" = BEHIND ] && reasons+=("pull request is behind its base")
[ "$review_decision" = CHANGES_REQUESTED ] && reasons+=("changes requested")
[ "$review_decision" = REVIEW_REQUIRED ] && reasons+=("review required")
[ "$merge_state" = DIRTY ] && reasons+=("merge has conflicts")

if [ "${#reasons[@]}" -gt 0 ]; then
  emit blocked "${reasons[@]}"
  exit 1
fi

pending=()
check_failures=()
while IFS=$'\t' read -r name bucket state; do
  case "$bucket" in
    pass|skipping) ;;
    pending) pending+=("check pending: $name") ;;
    fail|cancel) check_failures+=("check $bucket: $name") ;;
    *) check_failures+=("check has unknown bucket: $name") ;;
  esac
done < <(jq -r '.[] | [.name,.bucket,.state] | @tsv' "$checks_file")

if [ "${#check_failures[@]}" -gt 0 ]; then
  emit blocked "${check_failures[@]}"
  exit 1
fi
if [ "${#pending[@]}" -gt 0 ]; then
  emit pending "${pending[@]}"
  exit 8
fi

if [ "$mergeable" = UNKNOWN ] || [ "$merge_state" = UNKNOWN ]; then
  emit pending 'mergeability is unknown'
  exit 8
fi

if [ "$merge_state" = BLOCKED ]; then
  emit blocked 'merge is blocked'
  exit 1
fi

# A non-zero checks status with all explicitly reported buckets passing is
# still rejected: it indicates gh returned an error for which we lack data.
if [ "$checks_exit" -ne 0 ]; then
  emit blocked 'required check query failed'
  exit 1
fi

case "$review_decision" in
  APPROVED|'') ;;
  CHANGES_REQUESTED) emit blocked 'changes requested'; exit 1 ;;
  REVIEW_REQUIRED) emit blocked 'review required'; exit 1 ;;
  *) emit blocked 'review decision is unknown'; exit 1 ;;
esac
if [ "$mergeable" != MERGEABLE ]; then
  emit blocked 'mergeability is missing or not mergeable'
  exit 1
fi
if [ "$merge_state" != CLEAN ]; then
  emit blocked 'merge state is missing or not clean'
  exit 1
fi

emit ready
exit 0
