# Record retention

The starter's deployment-wide retention policy is defined here. Operators own
these settings. There is no per-workspace retention UI. These are product
defaults, with no claim of
legal compliance. Monitoring-provider logs follow that provider's separately
configured policy.

## Policy matrix

A day is 24 hours. Application validity checks reject expired credentials and
download links at their cutoff, even when physical cleanup has not run yet.
Suspension does not pause routine expiry.

| Record class                                                                               | Retention clock and default                                                                    | Cleanup owner and protection                                                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Workspace, security, billing and System Admin audit events                                 | 365 days from event time                                                                       | Application retention; independent recovery evidence is excluded                             |
| Read and unread notifications                                                              | 90 days from creation                                                                          | Application retention; reading does not reset the clock                                      |
| Accepted, rejected or canceled invitations                                                 | 30 days from terminal status                                                                   | Application retention; pending usable invitations remain                                     |
| Expired invitations                                                                        | 30 days from expiry                                                                            | Application retention; timestamps use the auth table's epoch representation                  |
| Expired sessions and verification records                                                  | Safe expiry, removed within 24 hours                                                           | Application cleanup after five minutes of skew; sessions referenced by OAuth evidence remain |
| Revoked or expired API Token metadata                                                      | 90 days from becoming unusable                                                                 | Application retention; preserve still-required token relationships                           |
| Terminal webhook deliveries and attempts                                                   | 30 days from final outcome                                                                     | Application retention; attempts delete with their delivery                                   |
| Export job metadata                                                                        | 30 days from recorded completion or failure                                                    | Application retention; unfinished work has no history cutoff                                 |
| Export ZIP artifacts                                                                       | Seven days                                                                                     | Existing R2 lifecycle; application enforces download expiry independently                    |
| Export download secrets                                                                    | Download expiry, or recorded export failure                                                    | Application retention clears expired secrets                                                 |
| Previous webhook signing secrets                                                           | Rotation grace expiry                                                                          | Application retention clears the previous secret; current signing state remains              |
| Billing processing evidence                                                                | 90 days from completion, or resolution after failure                                           | Application retention; unresolved failures remain until resolution starts their clock        |
| Completed or expired billing checkout claims                                               | 90 days from terminal update                                                                   | Application retention; pending or created claims remain for recovery                         |
| Delivered billing notices                                                                  | 90 days from delivery                                                                          | Application retention; undelivered notices remain                                            |
| Opaque OAuth access tokens and client assertion replay guards                              | Expiry plus five minutes of clock skew                                                         | Application retention; refresh tokens and token families are excluded                        |
| Retention progress                                                                         | One current cursor per record class                                                            | Application housekeeping; fixed-size operator state, no customer payloads                    |
| Email delivery evidence                                                                    | Normally 30 days; unresolved failures at most 90 days                                          | Application retention under the email delivery policy                                        |
| Independent encrypted database backups                                                     | 30 daily backups                                                                               | Operator's backup job, outside the production Cloudflare account                             |
| Independent deletion and credential-revocation evidence                                    | Every retained recovery point that could resurrect the state must expire, then seven more days | Independent evidence-store operator; never ordinary audit cleanup                            |
| OAuth rotation and replay evidence                                                         | Until protocol safety permits removal                                                          | Auth plugin owns token-family semantics; rotation alone is insufficient                      |
| Active consents, signing keys, SSO configuration, memberships and workspace business state | No age-only expiry                                                                             | Owning capability or auth plugin; explicit deletion/revocation applies                       |

Retention configuration must preserve supported replay horizons and credential
families. Consider clock skew, live descendants and foreign keys before deleting
security records. Auth tables store epoch seconds; starter tables store ISO
strings. Cleanup compares each clock in its stored representation. Existing terminal
invitations without a recorded terminal time receive a full 30-day grace period
from migration, rather than expiring based on their creation time.

## Recovery approval

Destructive scheduled cleanup starts disabled. Before enabling it for a customer
deployment, complete the isolated recovery drill in [operations](operations.md)
and retain its evidence outside the production Cloudflare account. The repository's
synthetic tests do not establish deployment recovery approval.

Review a dry-run preview and explicitly confirm the policy before its first
activation. Repeat that approval when shortening any period. An unapproved
configuration change must not widen deletion eligibility. Once approved,
ordinary hourly cleanup proceeds automatically under that policy.

## Unfinished work and backlog

Unresolved exports become recovery candidates after one hour; unresolved webhook
deliveries after 24 hours. Age flags work for inspection. It does not prove the
job has stopped. Check running work, leases and retry eligibility before recording
a terminal failure. History retention starts only after that recorded outcome.

Hourly cleanup scans at most 500 history rows by default, shared across 17
record classes. Each class gets a fair page allocation and a durable cursor.
The per-class cap is 100 and the configurable total cap is 1,000. Protected rows
also advance the cursor so they cannot block later eligible rows. A full page
marks possible remaining work; a short page resets that cursor for the next sweep.
Recovery diagnostics separately inspect at most 101 export rows and 51 webhook
rows per unresolved status. Cleanup resumes remaining work on later runs. Physical deletion targets 24 hours after eligibility. Operators must
watch backlog and the time of the last successful run; a sustained backlog can
miss that target even when individual invocations succeed.

Previews start at the oldest page and leave database rows and cursors unchanged.
Their candidate counts are lower bounds when a page is full, not total-table
counts. Execution reports reflect the current cursor. Preview and execution
include record classes, cutoffs, counts and sanitized outcomes. Secret-clearing
counts represent cleared rows, not deleted endpoints or export jobs. They must not expose record payloads, recipient addresses, credentials
or signed download links. A successful zero-work run is a success with zero
candidates; a query failure is a failed run. Routine cleanup does not create an
audit event for each deleted row. Explicit user and operator deletions remain
audited.

## Account and workspace deletion

Account deletion removes the user's personal notifications and email-delivery
records, and scrubs identifying details from retained audit metadata. Shared
workspace business records remain for other members. The account lifecycle's
ownership checks still apply.

Workspace deletion removes its operational data and retains a minimal system
audit record without copied customer content for the audit-retention period.
Deletion authorization, including suspension restrictions, remains with the
owning capability. Routine cleanup cannot act as a customer deletion bypass.

Explicit deletion takes precedence over routine retention. Existing independent
backups continue to expire on their backup schedule. Before reopening a restored
database, operators reapply independently retained deletion and revocation
records under the [recovery procedure](backup-recovery.md). Keep those minimal
identifiers and change timestamps until every relevant backup and Time Travel
point expires, plus seven days. If the oldest recovery point is extended, extend
the evidence period too. Ordinary audit expiry must never erase this evidence.

## Operator commands

Install the repository toolchain and apply its database migrations before
previewing. Read-only preview can run before recovery approval. Local preview
uses the same persisted D1 as local development:

```bash
pnpm run retention:operator preview --local --output /tmp/retention-preview.json
```

For a deployment, supply its D1 UUID and Alchemy stage, such as `prod` or
`pr-310`. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through the
operator's credential source. The command uses a remote D1 binding through
Wrangler and sends only the shared capability's preview queries:

```bash
pnpm run retention:operator preview --remote \
  --database '<D1 UUID>' --deployment prod \
  --output /tmp/retention-preview.json
```

The command prints the artifact path, target key, policy digest, counts and
backlog. Review the artifact's cutoffs and per-class pages. Preserve it in the
deployment's operations record. It expires for approval after 24 hours. A failed
query cannot produce an approvable artifact.

After the deployment's recovery drill has passed, confirm the exact digest and
target printed by the preview:

```bash
pnpm run retention:operator approve \
  --artifact /tmp/retention-preview.json \
  --confirm '<policy digest from preview>' \
  --confirm-target '<target key from preview>' \
  --recovery-evidence '<reference to the successful isolated drill>' \
  --output /tmp/retention-approval.json
```

Approval writes configuration; it does not delete records or deploy a Worker.
Apply the approval file's `environment` object through the deployment's normal
configuration flow. Keep recovery evidence outside the production Cloudflare
account. The command records the operator's evidence reference; it cannot verify
the drill on the operator's behalf. The [incomplete synthetic drill](operations/2026-09-07-isolated-drill.md)
is not sufficient evidence.

To change policy, set the proposed `RETENTION_*_DAYS`, `RETENTION_BATCH_SIZE`, or
`RETENTION_WORK_BUDGET` values for the preview command, then approve its new
artifact. The policy version, durations, budget and target are part of approval.
A changed value requires a matching new approval before scheduled deletion can
resume. Set `RETENTION_CLEANUP_ENABLED=false` to return to previews.

Provider-free Seed mode has no D1 history to clean and reports `inactive`.
Credential, invitation and signed-download validity remain with their owning
Seed and Live capabilities, independent of physical cleanup.
