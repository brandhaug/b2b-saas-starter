#!/usr/bin/env bash
set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/pr-readiness-test.XXXXXX") || exit 1
trap 'rm -rf "$tmp_dir"' EXIT
mock_bin=$tmp_dir/bin
mkdir -p "$mock_bin"

cat >"$mock_bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -u
scenario=${PR_READINESS_FIXTURE:-approved}
if [ "$1" = pr ] && [ "$2" = view ]; then
  count_file=${PR_READINESS_COUNT_FILE:?}
  count=$(cat "$count_file" 2>/dev/null || printf 0)
  count=$((count + 1)); printf '%s' "$count" >"$count_file"
  fixture="${PR_READINESS_FIXTURE_DIR:?}/$scenario-view-$count.json"
  [ -f "$fixture" ] || fixture="${PR_READINESS_FIXTURE_DIR:?}/$scenario-view.json"
  cat "$fixture"
elif [ "$1" = pr ] && [ "$2" = checks ]; then
  [ "$scenario" = api-failure ] && exit 1
  cat "${PR_READINESS_FIXTURE_DIR:?}/$scenario-checks.json"
  [ "$scenario" = pending ] && exit 8
  [ "$scenario" = failure ] && exit 1
  exit 0
else
  exit 1
fi
MOCK
chmod +x "$mock_bin/gh"
export PATH="$mock_bin:$PATH" PR_READINESS_FIXTURE_DIR="$tmp_dir" PR_READINESS_COUNT_FILE="$tmp_dir/count"

write_fixture() {
  scenario=$1
  sha=$2
  cat >"$tmp_dir/$scenario-view.json" <<EOF
{"headRefOid":"$sha","state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":"APPROVED","url":"https://example.test/pull/1"}
EOF
  printf '[{"name":"build","bucket":"pass","state":"SUCCESS","link":"https://example.test/check"}]\n' >"$tmp_dir/$scenario-checks.json"
}

run_case() {
  name=$1 expected_exit=$2 expected_state=$3
  shift 3
  : >"$tmp_dir/count"
  set +e
  output=$(PR_READINESS_FIXTURE="$name" bash "$script_dir/pr-readiness.sh" 1 "$@")
  status=$?
  set -e
  actual=$(printf '%s' "$output" | jq -r .state)
  [ "$status" -eq "$expected_exit" ] && [ "$actual" = "$expected_state" ] || {
    printf 'FAIL %s: exit=%s state=%s output=%s\n' "$name" "$status" "$actual" "$output" >&2
    exit 1
  }
}

write_fixture approved abc123
run_case approved 0 ready
run_case approved 1 blocked def456
cp "$tmp_dir/approved-view.json" "$tmp_dir/behind-view.json"
sed -i '' 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BEHIND"/' "$tmp_dir/behind-view.json" 2>/dev/null || sed -i 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BEHIND"/' "$tmp_dir/behind-view.json"
cp "$tmp_dir/approved-checks.json" "$tmp_dir/behind-checks.json"
run_case behind 1 blocked

write_fixture pending abc123
printf '[{"name":"build","bucket":"pending","state":"IN_PROGRESS","link":"x"}]\n' >"$tmp_dir/pending-checks.json"
sed -i '' 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BLOCKED"/' "$tmp_dir/pending-view.json" 2>/dev/null || sed -i 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BLOCKED"/' "$tmp_dir/pending-view.json"
run_case pending 8 pending

write_fixture failure abc123
printf '[{"name":"build","bucket":"fail","state":"FAILURE","link":"x"}]\n' >"$tmp_dir/failure-checks.json"
run_case failure 1 blocked

write_fixture cancelled abc123
printf '[{"name":"build","bucket":"cancel","state":"CANCELLED","link":"x"}]\n' >"$tmp_dir/cancelled-checks.json"
run_case cancelled 1 blocked

write_fixture skipping abc123
printf '[{"name":"build","bucket":"skipping","state":"SKIPPED","link":"x"}]\n' >"$tmp_dir/skipping-checks.json"
run_case skipping 0 ready

write_fixture absent abc123
printf '[]\n' >"$tmp_dir/absent-checks.json"
run_case absent 1 blocked

write_fixture stale abc123
cp "$tmp_dir/stale-view.json" "$tmp_dir/stale-view-2.json"
sed -i '' 's/abc123/def456/' "$tmp_dir/stale-view-2.json" 2>/dev/null || sed -i 's/abc123/def456/' "$tmp_dir/stale-view-2.json"
cp "$tmp_dir/approved-checks.json" "$tmp_dir/stale-checks.json"
run_case stale 1 blocked

write_fixture noreview abc123
sed -i '' 's/"reviewDecision":"APPROVED"/"reviewDecision":""/' "$tmp_dir/noreview-view.json" 2>/dev/null || sed -i 's/"reviewDecision":"APPROVED"/"reviewDecision":""/' "$tmp_dir/noreview-view.json"
run_case noreview 0 ready

write_fixture unknown abc123
sed -i '' 's/"mergeable":"MERGEABLE"/"mergeable":"UNKNOWN"/' "$tmp_dir/unknown-view.json" 2>/dev/null || sed -i 's/"mergeable":"MERGEABLE"/"mergeable":"UNKNOWN"/' "$tmp_dir/unknown-view.json"
run_case unknown 8 pending

write_fixture unknown-merge-state abc123
sed -i '' 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"UNKNOWN"/' "$tmp_dir/unknown-merge-state-view.json" 2>/dev/null || sed -i 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"UNKNOWN"/' "$tmp_dir/unknown-merge-state-view.json"
run_case unknown-merge-state 8 pending

write_fixture api-failure abc123
run_case api-failure 1 blocked

write_fixture meta-blocked abc123
cp "$tmp_dir/meta-blocked-view.json" "$tmp_dir/meta-blocked-view-2.json"
sed -i '' 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BLOCKED"/' "$tmp_dir/meta-blocked-view-2.json" 2>/dev/null || sed -i 's/"mergeStateStatus":"CLEAN"/"mergeStateStatus":"BLOCKED"/' "$tmp_dir/meta-blocked-view-2.json"
run_case meta-blocked 1 blocked

write_fixture meta-draft abc123
cp "$tmp_dir/meta-draft-view.json" "$tmp_dir/meta-draft-view-2.json"
sed -i '' 's/"isDraft":false/"isDraft":true/' "$tmp_dir/meta-draft-view-2.json" 2>/dev/null || sed -i 's/"isDraft":false/"isDraft":true/' "$tmp_dir/meta-draft-view-2.json"
run_case meta-draft 1 blocked

printf 'pr-readiness tests passed\n'
