# D1 backup and recovery

This procedure covers the shared D1 database used by every Workspace. A restore
changes data for the whole service. It cannot recover one Workspace in place.
Use paid Cloudflare as the customer deployment baseline because D1 Time Travel
is part of this recovery plan.

The targets below start when an operator begins recovery. They are targets to
prove at the deployment's tested data size, not an SLA.

| Failure                                                   | Method                       | Recovery time | Lost writes |
| --------------------------------------------------------- | ---------------------------- | ------------: | ----------: |
| Bad write or failed migration with a valid recovery point | D1 Time Travel               |        1 hour |  15 minutes |
| Deleted database or lost Cloudflare account               | Independent encrypted export |       4 hours |    24 hours |

Run a successful isolated drill before first customer use, every quarter, and
after changing the backup, schema, authentication, or recovery process. Keep
the drill record outside the production Cloudflare account.

## Independent backup setup

The [backup workflow](../.github/workflows/backup.yml) runs two independent
schedules. At 02:17 UTC it exports D1, encrypts the SQL with AES-256-GCM, uploads
it, and writes an encrypted authenticated completion record. At 04:47 UTC it
downloads and authenticates the newest completed backup, decrypts the SQL, and
checks its SHA-256 digest. Change the first schedule to the deployment's measured
low-traffic window.

Create a GitHub `backup` environment with no required reviewers. Required
reviewers would leave unattended scheduled backups waiting for approval. Set
`BACKUP_ENABLED=true` in that environment only after the following values work:

| Setting                                                             | Purpose                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `BACKUP_CLOUDFLARE_API_TOKEN` secret                                | Read and export only the production D1 database         |
| `BACKUP_CLOUDFLARE_ACCOUNT_ID` secret                               | Source Cloudflare account                               |
| `BACKUP_S3_BUCKET` secret                                           | Bucket in an account outside production Cloudflare      |
| `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` secrets | Write, read, list, and delete only the backup prefix    |
| `BACKUP_ENCRYPTION_KEY` secret                                      | 32 random bytes as 64 hex characters or standard base64 |
| `BACKUP_S3_ENDPOINT` secret                                         | Required for a non-AWS S3-compatible provider           |
| `BACKUP_DATABASE` variable                                          | Production D1 name, default `b2b-saas-starter`          |
| `BACKUP_S3_PREFIX` variable                                         | Object prefix, default `d1`                             |
| `BACKUP_S3_REGION` variable                                         | S3 region, default `us-east-1`                          |
| `SENTRY_DSN` secret                                                 | Sentry project DSN used to submit cron check-ins        |
| `SENTRY_BACKUP_MONITOR_SLUG` variable                               | Existing nightly backup monitor slug                    |
| `SENTRY_BACKUP_FRESHNESS_MONITOR_SLUG` variable                     | Existing independent freshness monitor slug             |

Configure both Sentry monitors with the committed schedules, a suitable check-in
margin, failure notification, and recovery notification. Route notifications to
operator email and the optional paging integration. Those routes must not use
the application's transactional email provider. The script requires a DSN and
the applicable explicit slug together, which prevents a typo from silently
creating an unintended monitor. Treat a disabled workflow, missing check-in, or
quota-disabled monitor as unhealthy.

The bucket account, its recovery route, and the encryption key must remain
recoverable without the production Cloudflare account. Keep the key separate
from the bucket credentials. Record the following outside both accounts:

- Cloudflare and GitHub account recovery, DNS access, the deployed Git revision,
  migration history, Alchemy state recovery, and provisioning instructions.
- Worker secrets, authentication key history, OAuth and Stripe credentials,
  email domain setup, signing keys, callbacks, and environment-specific URLs.
- Backup endpoint, bucket, prefix, region, credential recovery, key custody,
  Sentry project, monitor slugs, alert destinations, and approved quota budget.

Enable object versioning or object lock when the provider supports it. The tool
keeps one authenticated completed backup for each of the newest 30 UTC days. It
deletes both objects for older completed backups. Interrupted uploads, orphaned
objects, malformed names, and completion records that fail authentication do
not count toward the 30 days and are left for operator review.

## Backup operation

Run these commands through the root package scripts:

```sh
pnpm run backup:d1
pnpm run backup:d1:freshness
pnpm run backup:d1:prune
```

Wrangler and S3 child processes retry three times. The completion record is
uploaded only after S3 confirms the encrypted SQL object exists. It contains the
database and object names, start and completion times, SQL digest and sizes,
elapsed time through encrypted object confirmation, measured D1 export duration,
retention policy, and whether the export met the 60-second blocking budget. The
completion record is encrypted and authenticated with the same recovery key.

D1 export blocks database requests. `exportDurationMs` measures only the
`wrangler d1 export` child process, which is the blocking interval. Upload and
pruning time appear only in `durationMs`. The command preserves a completed
backup but exits nonzero if export exceeds 60 seconds, so Sentry opens an
incident. Revise and retest the backup approach before production approval if
the measured interval exceeds the budget.

## Choose the recovery action

Prefer a reviewed forward migration when the database remains usable. It keeps
writes after the defect and gives the operator a narrow change to rehearse.

Roll application code back only when the previous code is compatible with the
current schema and bindings. Roll back all affected Worker versions through
Cloudflare's version controls. Running an old Alchemy deployment can mutate
infrastructure or apply migrations, so it is not the rollback command.

Restore D1 when bad data or an irreversible migration cannot be repaired safely.
Use Time Travel when the database and account still exist. Use the independent
encrypted export after database deletion or account loss. A database restore
does not rewind Queues, R2, Stripe, OAuth providers, sent email, webhooks, DNS,
or downloaded Workspace exports.

Destroy and reseed remain valid for this repository's disposable pre-production
stages. They are not a customer-data migration or recovery procedure. Both
production and stage destroy scripts require the exact account and stage:

```sh
pnpm run destroy --confirm-target="$CLOUDFLARE_ACCOUNT_ID/prod"
ALCHEMY_STAGE=pr-42 pnpm run destroy:stage \
  --confirm-target="$CLOUDFLARE_ACCOUNT_ID/pr-42"
```

## Close the shared system

Before either restore method:

1. Stop deployments and record the operator, UTC time, account, database, stage,
   current Worker versions, selected recovery point, and expected lost writes.
2. Enable maintenance mode for web and API traffic. Pause background consumers,
   provider callbacks, and scheduled business jobs. Let active work drain.
3. Pause Cloudflare queue delivery. Record queue counts, oldest-message age,
   retry and dead-letter state, because D1 recovery will not rewind those queues.
4. Preserve forensic evidence and the current D1 bookmark when available. Confirm
   the exact target shown by the command before any destructive action.

Keep maintenance mode enabled through verification and reconciliation.

## Exercise Time Travel without production

Create a dedicated remote drill stage and database with synthetic users,
Workspaces, memberships, and sessions. Record a known row and UTC timestamp,
then introduce a reversible test fault. Ask Wrangler for the recovery point:

```sh
pnpm exec wrangler d1 time-travel info b2b-saas-starter-recovery-drill \
  --timestamp=2026-09-07T12:00:00Z --json
```

Review the returned bookmark and target. The wrapper below refuses the configured
production database and requires the exact account and isolated database name:

```sh
node scripts/d1-backup.ts pitr-drill \
  --database=b2b-saas-starter-recovery-drill \
  --timestamp=2026-09-07T12:00:00Z \
  --confirm-target="$CLOUDFLARE_ACCOUNT_ID/b2b-saas-starter-recovery-drill"
```

The wrapper resolves the database UUID before `wrangler d1 time-travel restore`
and uses Wrangler's JSON mode to avoid an interactive prompt. Never point this
drill command at production. After restore, query the known row, run the same
application and sign-in checks below, then destroy the isolated stage with the
exact-target guard.

## Restore an independent export

Start locally. Supply the encryption key and either an encrypted file or its S3
URL. An S3 URL also exercises bucket credentials and provider download:

```sh
BACKUP_ENCRYPTION_KEY=... pnpm run restore:d1:drill -- \
  s3://independent-bucket/d1/b2b-saas-starter/20260907T021700Z.sql.enc
```

The drill decrypts and authenticates the export, imports it into a new temporary
local Wrangler store and queries application tables. It reports counts for
users, Workspaces, memberships, and sessions, and rejects orphaned memberships
or sessions. It deletes the store after reporting the results. Compare those
counts with the incident or backup record. This proves the SQL can restore and
contains application and sign-in state. It does not prove provider latency,
recovered infrastructure, or a working sign-in flow until the remote isolated
drill passes.

For account-loss recovery, provision a new isolated account and empty database
first. Restore configuration from the independent operator record. Keep Stripe,
email, OAuth callbacks, customer webhooks, queues, and public DNS disabled. Then
run the guarded remote import:

```sh
BACKUP_DATABASE=b2b-saas-starter-recovery-drill \
  node scripts/d1-backup.ts restore \
  s3://independent-bucket/d1/b2b-saas-starter/20260907T021700Z.sql.enc \
  --database=b2b-saas-starter-recovery-drill \
  --confirm-target="$CLOUDFLARE_ACCOUNT_ID/b2b-saas-starter-recovery-drill"
```

The import command resolves the remote database UUID and refuses any target that
does not exactly match the account and database argument. An export contains
`CREATE TABLE` statements, so import it only into the empty recovery database.

## Verify, sanitize, and reopen

For a remote drill or incident, do all of the following before traffic resumes:

1. Run SQL integrity and foreign-key checks. Compare table counts, users,
   Workspaces, memberships, roles, security records, and key application rows
   with evidence captured at the recovery point. Record the schema revision.
2. Apply the independent security evidence bundle before reopening. For a drill,
   run:

   ```sh
   node scripts/recovery-security.ts apply \
     --evidence=recovery-evidence.json \
     --restore-point=2026-09-07T12:00:00Z \
     --freeze-time=2026-09-07T12:15:00Z \
     --database=b2b-saas-starter-recovery-drill \
     --local
   ```

   A remote run replaces `--local` with
   `--confirm-target="$CLOUDFLARE_ACCOUNT_ID/<database-name>"`. The evidence
   bundle must cover the restore point through the maintenance freeze time. The
   command invalidates restored sessions and OAuth grants and reapplies deletion
   and revocation evidence. A coverage gap triggers full account credential
   removal and a ban. Keep affected access blocked until an operator resolves
   any incomplete evidence.

3. Quarantine uncertain email, notification, export, and webhook jobs. Users can
   request fresh auth and invitation messages. An operator explicitly selects
   safe webhook replays.
4. Reconcile Stripe with its current authoritative state before billing workers
   resume. Never replay historical charges, refunds, cancellations, or checkout
   creation blindly.
5. Invalidate existing Workspace export links and regenerate exports when asked.
   Export ZIPs in R2 are disposable artifacts, not database backups.
6. Start the isolated application with external writes still disabled. Sign in
   with fresh credentials, verify a permitted Workspace action, and verify a
   cross-Workspace action is denied. Confirm old sessions, OAuth grants, revoked
   API tokens, password-reset links, and OTPs fail.
7. Resume customer requests under operator observation. Resume only reviewed
   queue work and scheduled jobs. Confirm readiness and Sentry recovery notices.

Urgent live credential revocation must continue if the independent evidence
store is unavailable. Alert on that evidence gap. A later restore across the gap
is unsafe until the credentials are revoked or reset, or an operator proves
their validity.

## Record drill evidence

Store a dated, sanitized record outside production with the Git revision,
operator, isolated account and database IDs, backup object and completion record,
row counts and database size. Include command logs and UTC times for the fault,
recovery point, restore start, restore finish, security cleanup, fresh sign-in,
denied old credentials, external-state review, and controlled reopening.

Record the measured recovery time, lost-write interval, and D1 export blocking
duration against the targets at the top of this page. Capture both failure and
recovery notifications for backup failure and stale backup, including their
Sentry monitor slugs and delivery times.

Repository verification on 2026-09-07 runs the restore command against synthetic
SQL in a fresh temporary local Wrangler store and checks one user, one Workspace,
one membership, one session, and their references. It never reads Cloudflare or S3
credentials. A remote isolated Time Travel drill, independent account rebuild,
provider download, application sign-in, measured service recovery, and delivered
Sentry notifications remain required after an operator configures those external
resources. Do not mark the production recovery plan approved until that live
isolated evidence exists.
