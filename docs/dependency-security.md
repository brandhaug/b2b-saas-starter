# Dependency security check

Workflow action pinning, committed-secret detection, and the credential incident
path are documented in the [CI security controls](ci-security.md).

## Scope and failure policy

The checks in [Audit](../.github/workflows/audit.yml) use pinned Trivy v0.74.0
to scan `pnpm-lock.yaml`, including production, development, transitive and optional
dependencies. On PRs, high and critical findings fail only for package name/version
pairs absent from the trusted base lockfile, unless covered by a current exception.
This includes added packages and upgrades/downgrades of direct or transitive
dependencies. Unchanged versions, including newly disclosed findings on those
versions, do not block PRs. Adding another dependency path to an already-present
version does not count as a new version.

PRs also show a separate `full audit` check that scans all dependencies and fails
on existing findings. Only the dependency-change `audit` check is required for
merging. Matrix fail-fast is disabled so a failed full scan cannot cancel it.

Pushes to `master`, manual runs and Monday 09:00 UTC runs run `full audit` too.
Scheduled runs detect newly disclosed vulnerabilities without a code change.
These full-scan failures do not block unrelated PRs.
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

Install Trivy v0.74.0, then run locally from the repo root with a checkout of the
trusted base. The runner scans both lockfiles with Trivy's package inventory,
filters unchanged package versions from the PR report, then uses Trivy's native
exception filter and restricted output template. Missing inventory and malformed
reports fail closed. It does not validate exception decision metadata.

```bash
node .github/scripts/run-trivy.ts /path/to/trusted-base-checkout --changes-only
```

Omit `--changes-only` for a full scan. For a diagnostic full scan using the current
checkout's proposed exceptions:

```bash
node .github/scripts/run-trivy.ts .
```

A diagnostic scan does not establish approval. CI selects the trusted revision
it logs. Do not add `--ignore-unfixed` or remove `--include-dev-deps` to bypass findings.

## Temporary exceptions

[`.trivyignore.yaml`](../.trivyignore.yaml) starts empty. Trivy owns finding matching,
package/version scope and expiry. The repository owner records the decision evidence;
there is no custom exception metadata validator or independent-review requirement.

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
       Approval: Link to the repository owner's decision record.
      Mitigation: Describe the compensating control and planned fix.
```

Copy the finding ID and exact versioned package URL from Trivy's JSON report, and
use the target `pnpm-lock.yaml`. Each exception covers that package version across
the workspace lockfile, including every dependency path and dependency type where
it occurs. It does not distinguish workspace importers. Approvers must assess that
whole scope. Use separate records for different findings or versions.

The owner must supply all of the example's fields, exact versioned PURLs, the exact
lockfile path, and a finite UTC expiry. Do not approve wildcard paths, versionless
PURLs, missing expiry, or an empty statement. Trivy permits broader/permanent ignore
records, so these restrictions require maintainer inspection. Malformed YAML fails
parsing; a valid expired exception stops suppressing the finding automatically.
The native YAML ignore format is marked experimental upstream; keep the Trivy
version pinned and rerun the regression cases when upgrading.

Prefer fixing the dependency. For an exception, submit a separate policy PR and
record the owner's decision covering finding, scope, rationale, mitigation and
expiry. Keep credentials and personal data out of the record.

Merge the policy first, then update the dependency PR against the new base.
Remove obsolete exceptions after fixes. Renewals require a fresh decision.
The solo maintainer can modify the workflow and policy; these controls do not
provide an independent approval boundary.

See [Trivy's native ignore format](https://trivy.dev/docs/latest/configuration/filtering/)
and [pnpm scanning coverage](https://trivy.dev/docs/latest/coverage/language/nodejs/).

## Regression evidence

```bash
TRIVY_BINARY=trivy pnpm exec vp test run .github/scripts/trivy.test.ts
pnpm run test:scripts
pnpm exec vp test run .github/scripts/run-trivy.test.ts
```

The first command exercises Trivy's real filter using synthetic JSON scan reports.
It proves high/critical failure, fixed and lower-severity success, accepted and
expired exceptions, and mismatched finding, package, version and lockfile failures.
No vulnerable package is installed and these cases require no database or network.
The audit job always supplies `TRIVY_BINARY` and runs these cases. The general script
suite explicitly skips them when that variable is unset, so ordinary development
does not require installing Trivy.

The runner tests exercise the CLI with a deterministic scanner substitute. They
cover unchanged versions, new advisories on unchanged versions, upgrades,
downgrades, new packages, missing inventory, invalid JSON, scanner errors and
full-scan behavior. They complement the real Trivy filter tests above.

The output template reports finding ID, severity, package, installed/fixed versions
and target. Tests verify that provider titles, descriptions and URLs do not leak
through it. CI withholds scanner stderr, which may contain infrastructure diagnostics;
use the local command to diagnose database access without publishing credentials.
A scan without findings exits successfully with no finding lines. Scheduled failures
need an owner to triage and resolve them; the check does not remediate dependencies.

## Required-check setting and operator evidence

`github.config.ts` declares `audit`, `ci`, `e2e` and `Conventional commit title`
as required checks from GitHub Actions, with no bypass actors. It requires a PR
with zero approving reviews and blocks default-branch deletion and force pushes.
Independent review is intentionally not required for this solo-maintainer repo.

After merging the dependency-change workflow, apply the
[GitHub-only Alchemy stack](deploying.md#repository-configuration-as-code).
Applying it before the workflow lands could make existing dependency debt block
PRs. A workflow file or checked-in ruleset alone does not establish enforcement.

Verify the effective settings with operator access:

```bash
gh api repos/brandhaug/b2b-saas-starter/rulesets
gh api repos/brandhaug/b2b-saas-starter/rulesets/21032781
gh api repos/brandhaug/b2b-saas-starter/branches/master/protection
gh pr checks <PR> --required
```

The update requires repository administration permission. Read back the ruleset
and confirm all four checks, active enforcement, default-branch selector, no bypass
actors, deletion/force-push blocks and the `pull_request` rule's zero approval count.
On a PR containing the new workflow, confirm `gh pr checks <PR> --required` lists
`audit`. Until then, operational evidence for these protections is incomplete.
Fork operators must inspect their own ruleset IDs, branch selectors, enforcement
and bypass permissions. Retain the observed settings, timestamp, PR head and check
run URL as operating evidence. An unavailable API or missing permission leaves
this evidence incomplete; do not infer enforcement from a green workflow.
