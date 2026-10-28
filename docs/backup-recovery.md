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

Use the optional [Alchemy setup](#optional-alchemy-setup), or create a GitHub
`backup` environment with no required reviewers. Required
reviewers would leave unattended scheduled backups waiting for approval. Store
the following secrets and variables in that environment. After verifying them,
set the **repository variable** `BACKUP_ENABLED=true` to enable both jobs.
GitHub evaluates their job-level conditions before environment variables become
available, so an environment-only flag leaves the jobs skipped. See
[GitHub's variable availability rules](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#configuration-variable-precedence).

| Setting                                                             | Purpose                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BACKUP_CLOUDFLARE_API_TOKEN` secret                                | D1 Read permission in the production account                                                                  |
| `BACKUP_CLOUDFLARE_ACCOUNT_ID` secret                               | Source Cloudflare account                                                                                     |
| `BACKUP_S3_BUCKET` secret                                           | Bucket in an account outside production Cloudflare                                                            |
| `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` secrets | Write, read, list, and delete the dedicated backup bucket; restrict to the prefix if the provider supports it |
| `BACKUP_ENCRYPTION_KEY` secret                                      | 32 random bytes as 64 hex characters or standard base64                                                       |
| `BACKUP_S3_ENDPOINT` secret                                         | Required for a non-AWS S3-compatible provider                                                                 |
| `BACKUP_DATABASE` variable                                          | Production D1 name, default `b2b-saas-starter`                                                                |
| `BACKUP_S3_PREFIX` variable                                         | Object prefix, default `d1`                                                                                   |
| `BACKUP_S3_REGION` variable                                         | S3 region, default `us-east-1`                                                                                |

Command failures fail the GitHub Actions job. Configure operator notifications
for failed Actions runs and verify delivery to both operators independently of
the application's transactional email provider. These jobs run outside Workers,
so Cloudflare Workers Issues does not collect their output.

The freshness job detects a stale backup only when it runs. GitHub failure
notifications do not detect disabled workflows or a missed schedule. Before
production approval, configure an independent scheduler/watchdog that checks
both workflows' latest successful run times, with a daily deadline and allowance
for GitHub scheduling delays. Alert on missing, cancelled, skipped, or overdue
runs, and verify recovery notification delivery. This watchdog is operator
configuration; the repository does not provision it.

Keep backup access and the decryption key recoverable outside production, with
the key separate from bucket credentials. Follow the
[operator custody checklist](operations.md#operator-configuration).

Enable object versioning or object lock when the provider supports it. The tool
keeps one authenticated completed backup for each of the newest 30 UTC days. It
deletes both objects for older completed backups. Interrupted uploads, orphaned
objects, malformed names, and completion records that fail authentication do
not count toward the 30 days and are left for operator review.

## Optional Alchemy setup

[`alchemy.backup.ts`](../alchemy.backup.ts) owns a private R2 bucket in a separate
Cloudflare account, two account-owned API tokens, the GitHub `backup` environment,
and its workflow configuration. It is disabled by default. Importing the module
does not deploy resources. Application deployment does not apply this stack.

1. Fill in [`backup.config.ts`](../backup.config.ts) with the repository, default
   branch, production account, a **different backup account**, dedicated bucket
   name, database name, and prefix. The default branch must match the repository.
   Do not reuse the application's workspace-export bucket.
2. Select the backup account in the Alchemy Cloudflare profile and set
   `CLOUDFLARE_ACCOUNT_ID` to that same account. The stack checks both against
   `backupAccountId` before declaring resources. Use an operator credential with
   API Tokens Write in both accounts and R2 bucket-management permission in the
   backup account. This bootstrap credential stays outside GitHub Actions.
   GitHub authentication needs environment, Actions-secret, and Actions-variable
   write access to the configured repository.
   A newly created environment has no approval wait. For an existing `backup`
   environment, remove any reviewers or wait timer before applying. The stack
   omits these optional fields because private repositories without Enterprise
   reject them even when their values are empty or zero.
3. Supply the **existing** `BACKUP_ENCRYPTION_KEY` from independent operator
   custody. Alchemy reads it as redacted configuration and never generates one.
   For a first deployment, create and escrow a 32-byte recovery key before this
   step. Losing or replacing it makes earlier backups unreadable. GitHub cannot
   return an existing Actions secret, so migration requires the escrowed value.
   The stack persists a SHA-256 identity of the decoded key bytes in repository
   variable `BACKUP_KEY_FINGERPRINT`. That identity survives stack removal and
   rejects a different key before publishing it. Equivalent hex/base64 encodings
   are accepted. Do not delete this variable to bypass a mismatch; a deliberate
   key rotation needs a separate recovery migration retaining old decryption keys.
4. Set `BACKUP_INFRA_ENABLED=true` in the operator shell. Review the plan with
   restrictive local file permissions:

   ```sh
    pnpm run bootstrap:backup:plan
   ```

   A plan can read provider state. It does not apply the proposed changes.
   Only when ready to enable scheduled backups, run `pnpm run bootstrap:backup`.
   The repository ships configuration only; no apply is required
   when adopting these files.

5. Run the backup workflow manually on the default branch, then the freshness
   and isolated restore checks. Configure the independent watchdog described
   above. Cloud permissions and remote recovery remain unverified until these
   operator checks pass.

The environment has no reviewers or wait timer and accepts only the configured
default branch. Alchemy publishes every secret and variable in the table above,
then sets repository-level `BACKUP_ENABLED=true` through explicit resource-output
dependencies. Disable `BACKUP_ENABLED` before changing credentials or removing
the stack, and let any running backup finish. On an existing deployment, a failed
update does not automatically turn off the previously enabled workflow.

State stays in local `.alchemy` storage, outside the production account. It
contains recoverable token values and the encryption key even though logs redact
them. Protect and independently back up this directory with restricted permissions;
never commit it or upload it as a CI artifact. Preserve the stack name and stage.

### Retention and SDK limits

The bucket uses Alchemy's `retain()` removal policy and `forceDestroy: false`.
Removing its declaration or destroying the stack leaves the encrypted objects
and bucket intact, while Alchemy forgets the resource. Re-adoption requires
operator review. No object-age deletion rule is installed. Application pruning
authenticates completion records and retains the newest 30 completed UTC days
even if the schedule stops for longer than 30 calendar days.

Alchemy beta.84 provides `R2.Bucket`, `ApiToken.AccountApiToken`, and GitHub
`Environment`, `Secret`, and `Variable`. Its `R2.S3Credentials` helper binds only
to Workers. This stack uses the native account-token resource and Cloudflare's
[documented S3 derivation](https://developers.cloudflare.com/r2/api/tokens/):
the token ID is the access key ID, and SHA-256 of the token value is the secret
access key. R2 grants object read/write access to this bucket, including list and
delete, without bucket-administration permission. It cannot restrict this token
to the `d1` prefix, so the bucket must be dedicated to backups.

`D1 Read` is the least-privilege supported account permission. It is not an
individual-database or export-only grant; the token can read other D1 databases
in the production account. No D1 write grant is created. Verify export with the
workflow before production approval.

The SDK supports bucket locks, but this stack does not set a lock. An indefinite
lock prevents authenticated pruning; an age lock can reject a same-day duplicate
that pruning is allowed to remove. R2 object versioning is not exposed as a
supported bucket setting. Retention here protects against stack removal and
schedule stalls, not malicious deletion by a holder of the object-write token.
Existing operator-managed bucket locks remain untouched.

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
backup but exits nonzero if export exceeds 60 seconds, which fails the
workflow job. Revise and retest the backup approach before production approval if
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
  --persist-to=/private/tmp/b2b-saas-starter-recovery-drill \
  --local
```

For a local drill, import the backup into the same `--persist-to` directory
with Wrangler before applying this command. For example, after decrypting the
export to `recovery.sql`, run:

```sh
pnpm exec wrangler d1 execute DB --local \
  --config=apps/api/wrangler.jsonc \
  --persist-to=/private/tmp/b2b-saas-starter-recovery-drill \
  --file=recovery.sql
```

The sanitizer uses the API worker's `DB` binding and requires the operator to
identify the restored persisted store.

For a remote run, omit `--persist-to` and `--local`, and use
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
