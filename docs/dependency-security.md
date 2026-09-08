# Dependency security check

## AC-12.1: scope and failure policy

The `audit` job in [Audit](../.github/workflows/audit.yml) uses pinned Trivy v0.74.0
to scan `pnpm-lock.yaml`, including production, development, transitive and optional
dependencies. High and critical findings fail unless covered by a current exception.
Pull requests, pushes to `master`, manual runs and Monday 09:00 UTC runs use the same
policy. Scheduled runs detect newly disclosed vulnerabilities without a code change.
Database download failures and scanner errors also fail the job.

The scan copies only the lockfile to a temporary directory, installs no application
dependencies, and explicitly enables development dependencies. It uses Trivy's
public vulnerability database rather than the npm registry audit endpoint. Results
can differ from `pnpm audit` because the tools use different advisory sources.

For PRs targeting the default branch, exceptions come from the exact PR base commit.
Other targets and non-PR runs use the default branch. Retargeting reruns the check.
The workflow logs the selected revision; both checkouts retain no credentials. The
initial base predates `.trivyignore.yaml`, so bootstrap applies no exceptions.
Proposed exception changes take effect after review and merge into the base.

Install Trivy v0.74.0, then run locally from the repo root:

```bash
audit_input="$(mktemp -d)"
cp pnpm-lock.yaml "$audit_input/pnpm-lock.yaml"
trivy fs --config /dev/null --scanners vuln --pkg-types library \
  --include-dev-deps --severity HIGH,CRITICAL --exit-code 1 \
  --ignorefile .trivyignore.yaml --format template \
  --template '@.github/trivy-report.tpl' "$audit_input"
```

This local command uses the current checkout's exceptions. To reproduce CI's policy,
pass the `.trivyignore.yaml` from its logged trusted revision instead. Do not add
`--ignore-unfixed` or remove `--include-dev-deps` to bypass findings.

## AC-12.2: temporary exceptions

[`.trivyignore.yaml`](../.trivyignore.yaml) starts empty. Trivy owns finding matching,
package/version scope and expiry. Independent PR review checks the decision evidence;
there is no custom metadata validator or audit report parser.

Use this native Trivy record shape. This is a synthetic example, not an approved
exception:

```yaml
vulnerabilities:
  - id: CVE-2099-12345
    paths:
      - pnpm-lock.yaml
    purls:
      - pkg:npm/fixture-package@1.0.0
    expired_at: 2030-02-01T00:00:00Z
    statement: >-
      Rationale: Explain why temporary acceptance is justified.
      Owner: @responsible-maintainer.
      Approval: Link to the independent approving PR review or decision record.
      Mitigation: Describe the compensating control and planned fix.
```

Copy the finding ID and exact versioned package URL from Trivy's JSON report, and
use the target `pnpm-lock.yaml`. Each exception covers that package version across
the workspace lockfile, including every dependency path and dependency type where
it occurs. It does not distinguish workspace importers. Approvers must assess that
whole scope. Use separate records for different findings or versions.

Reviewers must require all of the example's fields, exact versioned PURLs, the exact
lockfile path, and a finite UTC expiry. Do not approve wildcard paths, versionless
PURLs, missing expiry, or an empty statement. Trivy permits broader/permanent ignore
records, so these restrictions are enforced through review. Malformed YAML fails
parsing; a valid expired exception stops suppressing the finding automatically.
The native YAML ignore format is marked experimental upstream; keep the Trivy
version pinned and rerun the regression cases when upgrading.

Prefer fixing the dependency. For an exception, submit a separate policy PR and
obtain approval from the repository owner or delegated security approver who is
independent of the dependency change author. The review must cover finding, scope,
rationale, owner, mitigation and expiry. Record the approving review URL in the
statement; reapproval of the final policy change is required. Link syntax alone
is not proof of approval. Keep credentials and personal data out of the record.

Merge the reviewed policy first, then update the dependency PR against the new base.
If current findings block the policy-only PR, an operator must retain independent
approval under a controlled administrative process; the scanner does not waive its
failure. Remove obsolete exceptions after fixes. Renewals require fresh approval.
Keep the policy empty until the repository protections below are active.

See [Trivy's native ignore format](https://trivy.dev/docs/latest/configuration/filtering/)
and [pnpm scanning coverage](https://trivy.dev/docs/latest/coverage/language/nodejs/).

## AC-12.3: regression evidence

```bash
TRIVY_BINARY=trivy node --test .github/scripts/trivy.test.ts
pnpm run test:scripts
```

The first command exercises Trivy's real filter using synthetic JSON scan reports.
It proves high/critical failure, fixed and lower-severity success, accepted and
expired exceptions, and mismatched finding, package, version and lockfile failures.
No vulnerable package is installed and these cases require no database or network.
The audit job always supplies `TRIVY_BINARY` and runs these cases. The general script
suite explicitly skips them when that variable is unset, so ordinary development
does not require installing Trivy.

The output template reports finding ID, severity, package, installed/fixed versions
and target. Tests verify that provider titles, descriptions and URLs do not leak
through it. CI withholds scanner stderr, which may contain infrastructure diagnostics;
use the local command to diagnose database access without publishing credentials.
A scan without findings exits successfully with no finding lines. Scheduled failures
need an owner to triage and resolve them; the check does not remediate dependencies.

## AC-12.4: required-check setting and operator evidence

Require the exact check name `audit`, with GitHub Actions as its source, in the
active default-branch ruleset under Settings → Rules → Rulesets. Keep existing
required checks. Also require independent review before changes to the exception
policy or workflow can enter the trusted default branch.

Configure "Require a pull request before merging" with at least one approving
review, dismissal of stale approvals after pushes, and approval of the most recent
reviewable push. This protects these files as part of every PR. Verify that the
reviewer has write access and cannot approve their own change, and retain the
existing absence of ruleset bypass actors. Configure this review protection before
adding `audit` to the required checks.

Until both protections are active, a PR can still edit its workflow code, and
there is no enforceable approval/merge guarantee. Keep the policy empty until
activation. A workflow file alone does not establish those external controls.

Verify the effective settings with operator access:

```bash
gh api repos/brandhaug/b2b-saas-starter/rulesets
gh api repos/brandhaug/b2b-saas-starter/rulesets/21032781
gh api repos/brandhaug/b2b-saas-starter/branches/master/protection
gh pr checks <PR> --required
```

On 2026-09-08, the active default-branch ruleset `21032781` required `ci` and `e2e`
from integration `15368`, and branch protection required `Conventional commit
title`. Neither `audit` nor independent-review protection was configured.
Both controls are **operator activation pending**. Activate after this workflow is
merged and its `audit` check has run on the default branch. Once review protection
is configured, the required-check change is to append
`{"context":"audit","integration_id":15368}` to that ruleset's existing
`required_status_checks` array, leaving `ci`, `e2e` and every other setting intact.
An operator can prepare and inspect the update from a fresh read:

```bash
gh api repos/brandhaug/b2b-saas-starter/rulesets/21032781 > /tmp/dependency-ruleset-before.json
jq '{name, target, enforcement, conditions, rules, bypass_actors} |
  (.rules[] | select(.type == "required_status_checks") |
    .parameters.required_status_checks) |=
  (. + [{context: "audit", integration_id: 15368}] | unique_by(.context, .integration_id))' \
  /tmp/dependency-ruleset-before.json > /tmp/dependency-ruleset-update.json
diff -u <(jq '{name, target, enforcement, conditions, rules, bypass_actors}' /tmp/dependency-ruleset-before.json) \
  /tmp/dependency-ruleset-update.json
# After reviewing the diff and confirming the new workflow is live:
gh api --method PUT repos/brandhaug/b2b-saas-starter/rulesets/21032781 \
  --input /tmp/dependency-ruleset-update.json
gh api repos/brandhaug/b2b-saas-starter/rulesets/21032781
```

The update requires repository administration permission. Read back the ruleset
and confirm the `audit` entry, active enforcement, default-branch selector, and
the `pull_request` rule's approval count, stale-review dismissal and last-push
approval requirements. Confirm that a policy change without independent approval
cannot merge.
On a PR containing the new workflow, confirm `gh pr checks <PR> --required` lists
`audit`. Until then, AC-12.4 has incomplete operational evidence.
Fork operators must inspect their own ruleset IDs, branch selectors, enforcement
and bypass permissions. Retain the observed settings, timestamp, PR head and check
run URL as operating evidence. An unavailable API or missing permission leaves
this evidence incomplete; do not infer enforcement from a green workflow.
