# Dependency security check

## AC-12.1: scope and failure policy

The `audit` job in [Audit](../.github/workflows/audit.yml) evaluates the complete
lockfile, including production, development, transitive and optional dependencies.
Every high or critical advisory fails unless each affected version and dependency
path has a current exception. Lower severities remain informational. Pull requests,
pushes to `master`, manual runs and Monday 09:00 UTC runs use the same policy.
Scheduled runs detect newly disclosed findings even when no dependency changes.

Run the same check locally after `vp install`:

```bash
node .github/scripts/dependency-audit.ts
```

The check uses [pnpm's audit JSON report](https://pnpm.io/cli/audit). It retries
unusable reports and registry failures three times, with a minute between attempts,
then fails. An unavailable registry is incomplete security evidence. It never passes
because the registry failed. Valid findings fail immediately without retries.
Do not add pnpm advisory ignore lists or use `--ignore-unfixable`,
`--ignore-registry-errors`, `--prod` or `--no-optional` to bypass this policy.

## AC-12.2: temporary exceptions

[The exception file](../.github/dependency-audit-exceptions.json) starts empty.
Prefer updating the affected dependency. An exception requires a reviewed PR and
an approval comment or review from the repository owner or delegated security
approver. The dependency change author cannot self-approve risk acceptance.
The approval must name the finding, scope, mitigation and expiry. Keep supporting
evidence in that linked record and verify it during review.

Each record has this shape. This is a synthetic example, not an approved exception:

```json
{
  "finding": "GHSA-2345-6789-cfgh",
  "package": "fixture-package",
  "version": "1.0.0",
  "severity": "high",
  "scope": {
    "path": "apps/web>fixture-package",
    "dev": false,
    "optional": false
  },
  "rationale": "Explain why temporary acceptance is justified for this exact use",
  "owner": "@responsible-maintainer",
  "approvalEvidence": "https://github.com/brandhaug/b2b-saas-starter/issues/341#issuecomment-1",
  "mitigation": "Describe the compensating control and the planned fix",
  "expires": "2030-02-01T00:00:00.000Z"
}
```

Copy the GHSA, package, installed version, severity, path and dependency flags
from the check output. Matching is exact, with one record per path. Wildcards and
version ranges are invalid. Expiry is an absolute UTC timestamp and suppression
stops at that instant. Changed advisories, versions, severities, paths or dependency
flags require a new approval. Missing fields, unknown fields and invalid dates fail
the check. Remove obsolete records after fixes; renewals require fresh review.
pnpm 11.25 caps each finding at 100 paths. At that limit the check disables
exceptions for the finding because the affected scope may be incomplete.

The check validates the approval link's format, not the approver's identity or the
linked decision. Human review must verify that evidence. This repository-specific
link restriction must be adapted when forking the starter. Never put credentials
or personal data in exception text or evidence links.

## AC-12.3: regression evidence

```bash
node --test .github/scripts/dependency-audit.test.ts
pnpm run test:scripts
```

Synthetic pnpm reports cover failing high/critical findings, a fixed report,
accepted and expired exceptions, scope mismatches, incomplete reports and safe
output. CLI tests verify failing and successful exit codes. These tests install no
vulnerable package and run both in the audit job and the existing script test suite.

## AC-12.4: required-check setting and operator evidence

Require the exact check name `audit`, with GitHub Actions as its source, in the
active default-branch ruleset under Settings → Rules → Rulesets. Keep existing
required checks. A workflow file alone does not establish a merge gate.

Verify the effective settings with operator access:

```bash
gh api repos/brandhaug/b2b-saas-starter/rulesets
gh api repos/brandhaug/b2b-saas-starter/rulesets/21032781
gh api repos/brandhaug/b2b-saas-starter/branches/master/protection
gh pr checks <PR> --required
```

On 2026-09-08, the active default-branch ruleset `21032781` required `ci` and `e2e`
from integration `15368`, and branch protection required `Conventional commit
title`. The `audit` setting was absent on initial inspection. Setting verification
is **operator activation pending**. Activate after this workflow is merged and
its `audit` check has run on the default branch. The intended change is to append
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
and confirm the `audit` entry, active enforcement and default-branch selector.
On a PR containing the new workflow, confirm `gh pr checks <PR> --required` lists
`audit`. Until then, AC-12.4 has incomplete operational evidence.
Fork operators must inspect their own ruleset IDs, branch selectors, enforcement
and bypass permissions. Retain the observed settings, timestamp, PR head and check
run URL as operating evidence. An unavailable API or missing permission leaves
this evidence incomplete; do not infer enforcement from a green workflow.

The check prints advisory IDs, canonical public advisory links, package versions
and affected paths. Follow the advisory to choose a fix and coordinate an existing
dependency PR where possible. It withholds raw registry output, stderr, advisory
titles and exception prose because those can contain credentials. Diagnose registry
authentication locally without copying credentials or raw configuration into CI
logs, artifacts or issues. Scheduled failures need an owner to triage and resolve
them; a required PR check does not itself remediate the deployed application.
