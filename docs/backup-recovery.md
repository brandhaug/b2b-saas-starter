# D1 backup and recovery

Executable backup and restore procedures for the shared D1 database. The
[operations runbook](operations.md) owns recovery targets, operator custody,
system closure, and reopening approval. Complete its isolated drill before
customer use and after material recovery changes.

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

Keep backup access and the decryption key recoverable outside production, with
the key separate from bucket credentials. Follow the
[operator custody checklist](operations.md#operator-configuration).

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

D1 export can block database requests. `exportDurationMs` measures the
`wrangler d1 export` child process, a conservative upper bound on that interval. Upload and
pruning time appear only in `durationMs`. The command preserves a completed
backup but exits nonzero if export exceeds 60 seconds, so Sentry opens an
incident. Revise and retest the backup approach before production approval if
the measured interval exceeds the budget.

## Prepare for recovery

Use the [recovery decision table](operations.md#choose-the-recovery-action) to
choose forward repair, code rollback, Time Travel, or an independent export.
Before either restore, [close the shared system](operations.md#close-the-system-before-restoring),
including background work and provider queue delivery. Keep maintenance enabled
through security cleanup and external-state reconciliation.

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

Follow the [reopening checklist](operations.md#verify-and-reopen). Apply the
independent security evidence bundle before restarting the application. For a
local drill:

```sh
node scripts/recovery-security.ts apply \
  --evidence=recovery-evidence.json \
  --restore-point=2026-09-07T12:00:00Z \
  --freeze-time=2026-09-07T12:15:00Z \
  --database=b2b-saas-starter-recovery-drill \
  --local
```

For a remote run, replace `--local` with
`--confirm-target="$CLOUDFLARE_ACCOUNT_ID/<database-name>"`. Evidence must cover
the restore point through the maintenance freeze. The command invalidates
restored sessions and OAuth grants and reapplies deletion/revocation evidence.
Insufficient interval coverage aborts before any cleanup. Recorded gaps inside
a fully covering bundle remove account credentials and ban restored users until
an operator resolves access. Successful SQL import alone does not authorize reopening.

## Record drill evidence

Use the [drill record](operations/drill-record.md) and
[required evidence](operations.md#drill-evidence). Record recovery time, lost
writes, D1 export blocking duration, and delivered failure/recovery notifications.
The [dated synthetic drill](operations/2026-09-07-isolated-drill.md) identifies
which local checks passed and which provider checks remain unverified.
