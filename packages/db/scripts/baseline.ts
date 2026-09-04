// Records migrations as applied in Alchemy's bookkeeping table
// (`__alchemy_migrations`) on a deployed D1 — without executing them.
//
// Why: Alchemy's D1.Database `migrations` prop detects applied migrations by
// folder NAME. This repo squashes its migrations (packages/db/AGENTS.md), and
// a squash renames the one surviving folder, so the squashed migration looks
// pending on every database that already carries the schema — and the deploy
// dies on its first `CREATE TABLE` (`table \`account\` already exists`).
// Local dev resets its D1 after a squash; a deployed database cannot be reset
// that casually, so both deploy workflows run this script first.
//
// A migration is recorded ONLY when every table it creates already exists:
// "recorded as applied" then means "this migration has no work left to do".
// A squash that also adds tables the deployed database never received (a
// squash stacked on a red deploy chain) is deliberately left pending —
// recording it would silently skip the new tables — so the deploy fails
// loudly instead, and the honest repair is a reset (packages/db/AGENTS.md).
// Squashing already-deployed work, the routine case, is a pure rename and
// converges here.
//
// The row format mirrors Alchemy's own sqlite bookkeeping insert (see
// scripts/alchemy-bookkeeping.ts). A migration that creates no tables (pure
// ALTERs) is never baselined — a fresh database still needs Alchemy to run it.
//
// Usage: node scripts/baseline.ts [--local] | --remote --database=<d1 name>
//   (root scripts: `db:baseline:remote` for prod, `db:baseline:stage` for a
//    `pr-<number>` stage — mirroring `db:seed:stage`. Local mode exists to
//    rehearse against `packages/db/.wrangler/state`; day-to-day local D1 is
//    reset after a squash instead, per packages/db/AGENTS.md.)
//
// Like scripts/migrate.ts, this is a Node CLI entry point, not application
// code: no Effect runtime exists here, only argv, wrangler, and an exit code.
import {
  ENSURE_BOOKKEEPING_TABLE,
  bookkeepingRecord,
  decodeNames,
  sqlLiteral,
  tablesCreatedBy
} from './alchemy-bookkeeping.ts'
import { listMigrations } from '../src/migrations-fs.ts'
import { wranglerD1Execute, type Target } from './wrangler-d1.ts'

/**
 * Baselines the committed migrations against one D1: records each unrecorded
 * migration whose tables all already exist. Returns the names it recorded.
 */
export async function runBaseline(target: Target): Promise<Array<string>> {
  function execute(args: ReadonlyArray<string>, captureJson: boolean): Promise<string> {
    return wranglerD1Execute(target.database, [target.flag, ...args], captureJson)
  }

  await execute([`--command=${ENSURE_BOOKKEEPING_TABLE}`], true)

  function selectRecorded(): Promise<Array<string>> {
    return execute(['--command=SELECT name FROM __alchemy_migrations'], true).then(
      decodeNames
    )
  }
  const recorded = new Set(await selectRecorded())

  for (const { name, sql } of listMigrations()) {
    if (recorded.has(name)) {
      continue
    }
    const tables = tablesCreatedBy(sql).map(({ table }) => table)
    if (tables.length === 0) {
      continue
    }
    // All tables must exist: each contributes its own EXISTS marker, so a
    // migration that still has tables to create stays pending.
    const { hash, createdAtMillis } = bookkeepingRecord(name, sql)
    const guards = tables
      .map(
        (table) =>
          `EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${sqlLiteral(table)})`
      )
      .join(' AND ')
    const command = `INSERT INTO __alchemy_migrations (hash, created_at, name, applied_at)
SELECT ${sqlLiteral(hash)}, ${
      createdAtMillis === null ? 'NULL' : String(createdAtMillis)
    }, ${sqlLiteral(name)}, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM __alchemy_migrations WHERE name = ${sqlLiteral(name)})
  AND ${guards};`
    await execute([`--command=${command}`], true)
  }

  // Which inserts landed: re-read the bookkeeping and diff against the
  // pre-baseline set, rather than decoding wrangler's INSERT output shape.
  const after = await selectRecorded()
  return after.filter((name) => !recorded.has(name))
}

if (import.meta.main) {
  // Mirrors scripts/seed.ts's target parsing: local by default; remote needs
  // both flags because the database is then addressed by name, not by the
  // package's local wrangler config.
  const remote = process.argv.includes('--remote')
  const remoteDatabase = process.argv
    .find((arg) => arg.startsWith('--database='))
    ?.slice('--database='.length)
  if (remote && !remoteDatabase) {
    console.error(
      'baseline: remote baselining needs both --remote and --database=<d1 name> (e.g. b2b-saas-starter-pr-42)'
    )
    process.exit(1)
  }
  const database = remoteDatabase ?? 'b2b-saas-starter'
  const flag = remote ? '--remote' : '--local'

  const baselined = await runBaseline({ database, flag })
  if (baselined.length === 0) {
    console.log(
      `No baselining needed on ${database}: every committed migration is either recorded or still has work to do.`
    )
  } else {
    console.log(
      `Baselined ${baselined.length} migration(s) into __alchemy_migrations on ${database}: ${baselined.join(', ')}.`
    )
  }
}
