# CI security controls

The workflows use least-privilege default permissions, immutable action revisions,
and separate environments for jobs that can change production or operational data.
Pull-request jobs run with read-only repository access. Production deployment is
reachable only from the default branch after the required build and test jobs;
manual runs on other branches cannot use those credentials. Backup and queue
monitoring dispatches have the same default-branch restriction.

## Workflow dependencies

Every third-party action is pinned to a full commit SHA with a version comment.
When updating an action, an operator should review the upstream release and
changelog, resolve the release tag to its full commit, update the SHA and comment
in one pull request, and let the normal CI, audit, and review protections run.
Do not replace an immutable revision with a tag. Local composite actions are part
of this repository and are reviewed with the workflow that calls them.
The Vite+ installer is downloaded over HTTPS and checked against a recorded
SHA-256 before execution; update that digest only after reviewing the installer
release and recording the new value in the same change.

The catalog updater has a narrowly scoped write token because it opens dependency
update pull requests. Checkout does not persist credentials. The preview workflow
uses dedicated, non-production `preview` and `preview-cleanup` environments and
has deployment credentials only for same-repository pull requests; it skips forks
and Dependabot.
The environment secrets are named `PREVIEW_CLOUDFLARE_API_TOKEN`,
`PREVIEW_CLOUDFLARE_ACCOUNT_ID`, and `PREVIEW_BETTER_AUTH_SECRET`; the token must
be scoped to preview resources and have no production permissions. Keep required
reviewers and environment audit logging enabled for `preview`; `preview-cleanup`
must not require approval so teardown cannot be stranded. A same-repository pull
request is still untrusted code and must never receive
production credentials.
The repository variable `PREVIEW_ENABLED` is an operator-controlled gate; leave it
unset until both preview environments are configured and verified.

## Secret detection

The audit workflow runs the pinned Gitleaks Action v3 and a synthetic regression test.
The test checks a clean repository, catches a committed AWS-shaped fixture, and
fails if the configured binary is unavailable in CI. The fixture is never a real
credential and is created only in a temporary repository. Gitleaks detects the
patterns covered by its current rules; it cannot prove that every provider token,
encoded value, runtime secret, or value stored outside Git is safe. Operators must
still review secret changes and provider exposure.

The audit job is a required check only after an operator adds its exact check name
to the active default-branch ruleset. A green workflow before that change is
informational and does not protect merges. Required review, stale-approval
dismissal, approval of the latest push, and the absence of bypass actors are also
operator-owned GitHub settings. Record the ruleset response, check-run URL, commit,
and observation time in the private security record; do not commit credentials or
private evidence links.

## Credential incident path

When a secret is detected, stop using the affected credential, preserve the alert
and commit metadata without copying the secret value, and restrict access to the
incident record. Revoke or rotate it at the issuing provider, replace the GitHub
secret or environment value, and invalidate dependent sessions, signing keys, or
deployment tokens as applicable. Remove the value from the repository and history
only after preserving the minimum evidence and confirming that rotation makes old
copies unusable; history rewriting is not a substitute for revocation.

Check workflow logs, artifacts, caches, pull-request comments, forks, and provider
audit records for exposure. Clean up exposed artifacts and notify affected owners
or providers according to the operator's incident procedure. Record detection,
scope, revocation time, replacement, evidence locations, cleanup, and follow-up
prevention. Never paste the credential into an issue, log, test, or evidence file.

GitHub secret storage, environment approval rules, default-branch rulesets,
repository Actions policy, and provider-side audit logs cannot be verified from
the repository. Treat them as incomplete until an authorized operator records
fresh observations.
