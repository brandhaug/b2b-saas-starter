# Isolated recovery drill, 2026-09-07

This is partial implementation evidence for #286, not production recovery approval.
The test used a newly created remote D1 database with synthetic starter fixtures.
No production database was restored or changed.

## Remote Time Travel and export

- Database: `b2b-saas-starter-recovery-drill-286-20260907`.
- Database ID: `c65ee8dc-4db9-436d-a9bc-70cfd730ea65`.
- Tested database size: 589,824 bytes; SQL export: 46,027 bytes.
- Applied the repository migrations and SQL from `node scripts/seed.ts --print`.
- Captured a bookmark with `wrangler d1 time-travel info <drill-db> --json`.
- Changed the synthetic `wrk_starter` name to `post-bookmark-drill-mutation`.
- Restored with `wrangler d1 time-travel restore <drill-db> --bookmark=<captured-bookmark> --json`.
- Verified `wrk_starter` was named `Starter Lab` again, five users and four
  memberships were present, and `PRAGMA foreign_key_check` returned no violations.

The mutation was confirmed at 14:53:29 UTC, restore response at 14:54:31 UTC,
and restored-row verification at 14:55:00 UTC. The fault-to-data-verification
interval was under two minutes. This does not measure full service recovery:
maintenance rollout, external reconciliation, credential cleanup and reopening
were not exercised remotely. Only the deliberate post-bookmark mutation was
lost; the fixture did not model concurrent customer writes.

`wrangler d1 export <drill-db> --remote --output=<temporary-sql-file>` ran from
14:55:25.785 to 14:55:29.494 UTC: 3,709 ms total. The full command duration is a
conservative upper bound on its database-blocking interval and is below the
60-second budget at this synthetic size. Repeat at the adopter's expected size
and traffic; this does not establish production performance.

The temporary remote database was deleted after export and row verification.
The exported SQL contains synthetic data only.

## Local checks and remaining evidence

A separate isolated local D1 import of the remote restored export passed a real
Better Auth `signInEmail` call for `usr_demo` using the seeded credential. This
verifies fresh sign-in against restored data; it does not claim remote Worker
deployment or controlled production reopening.

The automated encrypted restore test imports SQL into an isolated local D1
store and verifies identities, Workspaces, membership and session references.
The tests also reject tampered backups and incomplete completion evidence,
exercise retention and freshness policies, and check destructive target guards.

Independent S3 upload/download and key recovery, a lost-account rebuild,
Sentry failure/recovery notification delivery and deduplication, remote queue
failure drills, and full recovery-time/data-loss targets remain unverified.
Use [the complete drill record](drill-record.md) for the deployment's evidence.
This record does not approve destructive cleanup for customer data.
