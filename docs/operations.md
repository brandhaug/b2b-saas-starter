# Recovery and production monitoring

This runbook implements the operating policy agreed in [issue #286](https://github.com/brandhaug/b2b-saas-starter/issues/286).
An operator owns recovery decisions. Alerts never restore a database or roll
production code back automatically. The shared D1 database serves every
Workspace, so recovery closes and restores the whole application. Selective
Workspace recovery is outside this procedure.

## Production approval

Use paid Cloudflare for customer deployments. Complete an isolated restore drill
before first production use, quarterly, and after material recovery changes.
Keep the signed drill evidence outside the production Cloudflare account.
Do not enable [destructive scheduled cleanup](retention.md) until this passes.

| Incident                                                        | Recovery target from operator start | Maximum lost writes target |
| --------------------------------------------------------------- | ----------------------------------- | -------------------------- |
| Bad writes or migration, valid Time Travel point available      | 1 hour                              | 15 minutes                 |
| Database deletion or account loss, independent backup available | 4 hours                             | 24 hours                   |

These are drill targets at the deployment's tested size. They are not an SLA.
Record the last valid recovery point, actual lost-write interval, and elapsed
recovery time. A corruption discovered late may require an older point and
miss the target; report that explicitly.

D1 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
restores a database in place. It cannot clone production into an isolated
copy. Exercise Time Travel on a database created specifically for the drill.
An account-loss drill restores an independent encrypted SQL backup into a new
isolated database.

## Operator configuration

Assign a primary operator and backup operator. Record their email destinations,
Sentry organization/project/environment, optional paging integration, and the
secret-manager locations below in the deployment's private operations record.
Do not commit secrets or customer backup contents.

Keep these recoverable outside the production Cloudflare account:

- Git revision, lockfile, migration history, deployment instructions and Alchemy
  state recovery procedure. Preserve the deployed revision even after refactors.
- DNS and domain registrar access, Cloudflare account recovery, and permission
  to provision D1, Workers, Queues, R2 and email in a replacement account.
- Worker secrets, auth key history needed to read encrypted fields, Stripe and
  OAuth credentials, sender-domain configuration, callback URLs and signing keys.
- Independent backup bucket endpoint, bucket/prefix, credentials, encryption
  key and key-recovery instructions. Keep the decryption key separate from the
  backup bucket and production account.
- Independent deletion and credential-revocation evidence, including any known
  periods when evidence writes failed.
- Sentry configuration, alert routing, monitor inventory and approved budget.

Restore credentials into the isolated environment using its own URLs and keys.
Do not enable live Stripe writes, email delivery or customer webhooks in a drill.
If account loss requires new resource IDs, provision a new stage and bind the
restored database explicitly. Verify every binding and callback before traffic
moves. Recovering SQL alone does not rebuild the service.

For backup configuration and executable restore commands, see
[D1 backup and recovery](backup-recovery.md).

### Independent security evidence store

Production web and API Workers require `SECURITY_EVIDENCE_URL` and the
`SECURITY_EVIDENCE_TOKEN` secret. The URL must be an HTTPS service whose data,
credentials, and recovery path are outside the production Cloudflare account.
The Workers send `POST` requests with `Authorization: Bearer <token>` and
`Content-Type: application/json`. The service must append the record
durably before returning a 2xx response. It must treat duplicate record IDs
idempotently, returning 2xx without overwriting or deleting an earlier record,
and retain records until every backup and Time Travel point that could resurrect
the affected state expires, plus seven days. Extend evidence retention whenever
the oldest restorable point is extended. Restrict the token to append-only access; use a separate
operator credential for export.

Each request body has this shape:

```json
{
  "id": "sec_...",
  "kind": "api_token_revoked",
  "subjectId": "tok_...",
  "workspaceId": "wrk_...",
  "occurredAt": "2026-09-07T12:10:00.000Z",
  "source": "live"
}
```

`kind` is one of `account_deleted`, `workspace_deleted`,
`workspace_access_removed`, `api_token_revoked`, `oauth_grant_revoked`,
`sessions_revoked`, or `credential_changed`. A role change uses
`workspace_access_removed`: after a restore, the sanitizer removes that
membership for operator review so an older admin or owner role cannot reopen.
The IDs are references only. Do not store passwords, tokens, email bodies, or
provider payloads.

Export the recovery interval as one JSON bundle. `coverageStart` must be at or
before the selected restore point, and `coverageEnd` must be at or after the
time maintenance stopped writes:

```json
{
  "version": 1,
  "coverageStart": "2026-09-07T12:00:00.000Z",
  "coverageEnd": "2026-09-07T12:15:00.000Z",
  "gaps": [],
  "records": [
    {
      "id": "sec_...",
      "kind": "workspace_access_removed",
      "subjectId": "usr_...",
      "workspaceId": "wrk_...",
      "occurredAt": "2026-09-07T12:10:00.000Z",
      "source": "live"
    }
  ]
}
```

The evidence write has a three-second timeout and never rolls back the live
security mutation. Any failed append emits `security_evidence_gap` through the
independent Sentry path with the evidence ID, kind, subject reference, Workspace
reference, service, and environment. Investigate every event. If the mutation
can be reconstructed, append its record and document the gap as resolved before
export. Otherwise include the sanitized reference in `gaps`; the recovery
sanitizer then revokes every API token, removes account credentials and passkeys,
and bans restored users pending verification. Keep maintenance enabled until an
operator has reset or verified the affected access and closed the Sentry alert.

## Choose the recovery action

| Finding                                                   | Operator action                                                                      | Required evidence before reopening                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Bad code, current schema compatible with previous version | Roll back all affected Worker versions                                               | Previous version passes restored-schema and sign-in checks; bindings and secrets still match |
| Schema defect with intact data                            | Apply a reviewed forward migration                                                   | Rehearsed repair, row/invariant checks, migration history and application smoke pass         |
| Corrupt writes or irreversible migration                  | Restore a known D1 point, then repair security and external state                    | Restore point predates defect, lost-write interval accepted, reopening checklist complete    |
| Deleted database or lost account                          | Rebuild from independent encrypted SQL backup and separately recovered configuration | Data integrity, configuration, sign-in and provider reconciliation verified                  |

Do not run `alchemy deploy` at an old revision as a shortcut for code rollback:
it can mutate infrastructure and apply migrations. Record current Worker version
IDs and use the Cloudflare Worker version rollback controls for each affected
Worker after reviewing schema and binding compatibility. A code rollback does
not revert D1, queued messages, R2 objects, Stripe operations or sent email.
Reconcile Alchemy state with the chosen code before the next ordinary deploy.

For customer deployments, retain migration history and use forward migrations.
The starter's table-name baseline heuristic is insufficient proof that a
squashed schema matches a deployed customer database. Never destroy/reseed to
repair that mismatch. Rehearse a targeted migration against an isolated copy.

## Close the system before restoring

1. Declare the incident and stop automatic deployments. Record UTC start,
   operator, account ID, stage, database ID, current Worker versions and
   selected recovery point in the independent incident record.
2. Enable system-wide maintenance on web, API and background Workers. Verify
   customer requests, auth routes, inbound provider callbacks and business
   scheduled work cannot write. Pause queue delivery at the provider too; retries
   alone consume retention and retry budgets. Allow active invocations to drain.
3. Record queue names, pending counts, oldest-message age and retention deadlines.
   Record the current database bookmark and preserve forensic evidence when
   available. Do not rely on an export of corrupt data as the only backup.
4. Confirm the exact account and database target before any destructive command.
   Drills must use dedicated isolated targets with synthetic data. A production
   incident requires an operator's explicit production-target confirmation.

## Verify and reopen

Keep maintenance enabled until every step has evidence and an operator signs off.

1. Verify SQL integrity, foreign keys, expected users, Workspaces, memberships,
   role assignments and application records. Compare known fixture values and
   counts to evidence captured at the recovery point. Record the schema revision.
2. Invalidate restored sessions and OAuth grants. Replay independently retained
   deletion and revocation evidence. Revoke API credentials whose continued
   validity cannot be proved. Missing evidence is a reason to keep affected
   access closed, not to assume that restored credentials are valid.
3. A live revocation must succeed even if the independent evidence store is down.
   Resolve the resulting evidence gap before reopening a restore across it.
   If evidence cannot be recovered, revoke/reset the affected credentials and
   remove uncertain access. Never recover old password-reset links or OTPs.
4. Quarantine uncertain email and webhook jobs. Provider queues were not rewound
   with D1. Remove or hold pre-restore messages before resuming consumers so
   they cannot recreate outgoing actions. Users initiate fresh auth and invitation
   resends. Operators review and explicitly replay suitable webhooks.
5. Treat Stripe as current financial authority. Inspect each affected Workspace
   through `pnpm run billing:operator -- inspect --workspace <id>`, reconcile
   current subscriptions and billable membership, and resolve conflicts using
   [billing operations](billing-operator-runbook.md). Do not replay old charges,
   refunds, cancellations or checkout creation blindly.
6. Invalidate existing Workspace export links and mark stale export jobs for
   regeneration. Export ZIPs in R2 are disposable and are not system backups.
   D1 recovery cannot remove copies already downloaded or rewind R2 state.
7. Verify sign-in with fresh credentials and confirm old sessions, OAuth tokens
   and revoked API Tokens fail. Check a permitted Workspace action and a denied
   cross-Workspace action. In a drill, use synthetic identities only.
8. Reopen customer requests under operator observation, then resume reviewed
   queue work and scheduled jobs. Verify readiness, provider reconciliation and
   alert recovery notifications. Record finish time and measured lost writes.

A recovery point does not undo messages already delivered, webhook side effects,
Stripe state, external identity changes or deleted access. Keep an incident list
of these differences and the operator's resolution for each.

## Alert ownership and response

Sentry sends operator email directly. Its optional paging/chat integration must
also be independent of the application's transactional email provider. Configure
notifications for both incident opening and recovery. Group repeated events by
service, environment and failure kind, preserving request/job/provider IDs as
evidence rather than incident keys. A missing check-in or deactivated monitor
is not a healthy result.

| Condition                 | Initial policy                                                        | Evidence and first action                                                                                            |
| ------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web/API readiness         | Failure continuously for 5 minutes                                    | URL, dependency result, release, first/last failure; inspect bindings/D1, then evaluate code rollback                |
| Worker server errors      | More than 5% in 5 minutes, at least 20 requests                       | Numerator, denominator, service, release, trace IDs; identify failing route and dependency                           |
| Billing synchronization   | Unresolved for 15 minutes                                             | Workspace, provider event and reconciliation outcome; inspect current Stripe state and use audited recovery          |
| Queue backlog             | Oldest pending work exceeds the deployment's agreed processing budget | Queue name, age, count, retry/DLQ counts; inspect consumer and provider health before resuming                       |
| Exhausted background work | Any terminal exhausted job                                            | Job/delivery ID, queue, attempts, sanitized cause; repair cause, then review explicit retry                          |
| Scheduled work            | Failed, missed or timed-out completion                                | Monitor slug, scheduled time, check-in ID; inspect invocation and overlapping executions                             |
| Nightly backup            | Failed run or no successful backup in 26 hours                        | Object key, completion time, encrypted object verification, export duration; repair credentials/store and run backup |
| Systemic email failures   | Repeated transport or event-consumer failures                         | Purpose, sanitized outcome, provider/message IDs; inspect sender/provider and event subscription                     |
| Recovery evidence gap     | Any failed independent security-record write                          | Mutation category, safe identity reference, time; preserve live revocation and resolve recovery evidence             |

Individual recipient bounces remain delivery diagnostics. They should not page
operators as systemic email outages. Never attach raw email bodies, tokens,
secret links, payment details or raw provider payloads to alerts.

See [monitor configuration](monitoring.md) for exact runtime metric names,
cron slugs, initial thresholds and provider setup gaps.

## External monitors and budget

Create separate Sentry uptime monitors for the deployed web and API readiness
URLs, using GET, a one-minute interval, five consecutive failures and one
successful recovery check. Use a timeout appropriate to the readiness probe.
Sentry's [uptime configuration](https://docs.sentry.io/product/monitors-and-alerts/monitors/uptime-monitoring/)
explains failure/recovery tolerances and notification routing. Do not monitor
only the public landing page.

Inventory every scheduled task, including nightly backups and backup freshness.
Use a paid Sentry plan with a pay-as-you-go budget for that inventory, in
addition to the two uptime monitors. The included one uptime and one cron monitor do not cover this
setup. Record the provider's current quote and approved monthly cap in the
private deployment record; review active monitor counts and budget alerts after
every new job and billing renewal. Sentry can deactivate monitors when the
budget is insufficient; see [monitor quotas](https://docs.sentry.io/pricing/quotas/manage-cron-monitors/).
Provisioning DSNs alone does not configure alert destinations.

## Drill evidence

The [2026-09-07 synthetic drill](operations/2026-09-07-isolated-drill.md) records
partial implementation evidence and outstanding provider checks.

Use the [drill record](operations/drill-record.md) to capture results for both
recovery paths and every alert. Keep the completed record outside the production
Cloudflare account.

Create a dated record outside the production account with the operator, isolated
account/database IDs, revision, database row count/size and sanitized command log.
For each recovery path, capture known data before the fault, fault time,
recovery point, restore start/end, security cleanup, fresh sign-in and denied old
credentials, external-state review and controlled reopening. Record whether each
target passed. Measure the D1 export blocking interval at the tested size; the
budget is 60 seconds. A missed budget blocks production approval until the
backup approach is revised and retested.

Exercise each alert with a controlled failure and recovery in isolation. Capture
both delivered notifications and their UTC timestamps. Include a five-minute
readiness outage, at least twenty requests with a server-error ratio above 5%,
15-minute unresolved billing synchronization, queue backlog/exhaustion, failed
and missed scheduled jobs, failed and stale backups, systemic email/event
processing failure and independent security-store failure. Restore each
component and prove recovery notification delivery and incident deduplication.
During the email failure, operator notifications must still arrive.

Local tests can prove policy decisions and safety guards. They cannot establish
D1 Time Travel performance, independent account/key recovery, remote queue
behavior or Sentry email delivery. Do not mark those checks passed without a
live isolated drill and its evidence.
