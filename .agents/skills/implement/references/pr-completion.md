# PR completion

## Validate and publish

Run the repository's final validation command documented in `docs/setup.md`.
Record the tested revision and exact outcomes. If a prerequisite is unavailable,
identify which checks could not run and use CI evidence where it exercises the
same behavior. Required failures remain blockers.

Read `.github/PULL_REQUEST_TEMPLATE.md` and fill the body from the final diff and
evidence. Include the issue link and AC coverage. Explain meaningful limitations;
an untested provider path is not a verified integration.

Commit and push the task branch. Create the PR, or update the existing task PR,
with a Conventional Commit title and `--body-file`. Rewrite the title/body when
the final scope changed. Keep incomplete work draft. Creating a PR is part of
this implementation workflow unless the user set a narrower endpoint.

## Watch and repair

Delegate a read-only watcher. Give it the PR URL and expected head SHA. It runs
`gh pr checks <pr> --required --watch --interval 30`, then
`bash .github/scripts/pr-readiness.sh <pr> <expected-sha>`.
The helper returns JSON and exits 0 for ready, 8 for pending, or 1 for blocked.
It checks a snapshot; readiness is not a promise that the base cannot change.

The watcher returns the head SHA, failed or pending check names and URLs,
merge/review state, and blocker reasons. Required skipped checks are accepted only
when GitHub accepts them; explain any skipped validation relevant to the change.
Also inspect non-required checks such as Preview and disclose failures. A failed
preview is not proof of an application defect or permission to change deployment
secrets.

The orchestrator diagnoses failed jobs from their logs and delegates concrete
fixes. After every push, give the watcher the new head SHA. Ignore superseded or
canceled runs for an old head. If the branch is behind, update it from the base,
resolve conflicts, review the integration, validate affected behavior, and watch
the resulting revision. A changed head invalidates the previous readiness result.

For infrastructure outages, bound retries to two attempts with a reason for each.
Escalate missing credentials, required human approval, or repeated external
failures with the exact action needed. Continue independent repairs. A pending
check, unknown merge state, or inaccessible API never counts as ready.

When the watcher reports ready, the orchestrator runs the readiness helper once
more against the same head and updates PR validation evidence. Finish with the PR
URL, verified SHA, check results, and remaining limitations. Stop before merging
unless merging was explicitly requested. If readiness cannot be established,
report the PR as blocked or pending with the reason, not as complete.
