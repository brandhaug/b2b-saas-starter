// Gates the migrations folder and the schema before a migration can ship.
//
// 1. History: every snapshot's `prevIds` names an earlier folder, and exactly
//    one snapshot is the root. drizzle-kit verifies this only for postgresql,
//    so a deleted middle migration would otherwise pass every SQLite check
//    while fresh databases silently skip its SQL.
// 2. `drizzle-kit check`: readable snapshots and branches that do not conflict.
// 3. `drizzle-kit generate --explain`: diffs the TypeScript schema against the
//    newest snapshot without writing anything. Any status other than
//    `no_changes` means a schema edit lacks its migration.
//
// Usage: node scripts/check-migrations.ts
//
// Like scripts/migrate.ts, this is a Node CLI entry point outside any Effect
// runtime; its exit code is the contract with the `db:check` package script.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Option, Schema } from 'effect'
import { listMigrations, migrationsDir } from '../src/migrations-fs.ts'

const packageDir = join(import.meta.dirname, '..')
// This package's own bin, so the gate never reaches for a global install.
const drizzleKitBin = join(packageDir, 'node_modules', '.bin', 'drizzle-kit')
// drizzle-kit's parent id for the first migration.
const rootParentId = '00000000-0000-0000-0000-000000000000'
// `20260907080000_billing_reliability` was generated on a branch whose parent
// migration never merged. The merge folder after it holds the full SQLite
// schema, so no SQL is missing; rewriting the snapshot would break the rule
// against editing snapshots.
const unmergedParentIds = new Set(['0ab08f3a-8dce-4627-bb0b-2f55490d061b'])

const Snapshot = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, prevIds: Schema.Array(Schema.String) })
)
const decodeSnapshot = Schema.decodeUnknownSync(Snapshot)

const Envelope = Schema.fromJsonString(Schema.Struct({ status: Schema.String }))
const decodeEnvelope = Schema.decodeUnknownOption(Envelope)

/** A gate's failure output, or undefined when it passes. */
type Gate = {
  readonly name: string
  readonly run: () => string | undefined
  readonly remedy: string
}

function historyProblems(): string | undefined {
  const folders = listMigrations().map(({ name }) => ({
    name,
    snapshot: decodeSnapshot(
      readFileSync(join(migrationsDir, name, 'snapshot.json'), 'utf8')
    )
  }))
  const folderById = new Map(folders.map(({ name, snapshot }) => [snapshot.id, name]))
  const problems: Array<string> = []
  if (folderById.size !== folders.length) {
    problems.push('two migration folders share a snapshot id')
  }
  const roots = folders.filter(({ snapshot }) =>
    snapshot.prevIds.includes(rootParentId)
  )
  if (roots.length !== 1) {
    problems.push(
      `expected one first migration, found ${roots.length}: ${roots.map(({ name }) => name).join(', ')}`
    )
  }
  for (const { name, snapshot } of folders) {
    for (const parentId of snapshot.prevIds) {
      if (parentId === rootParentId || unmergedParentIds.has(parentId)) {
        continue
      }
      const parent = folderById.get(parentId)
      if (parent === undefined) {
        problems.push(`${name}: parent snapshot ${parentId} is missing`)
      } else if (parent >= name) {
        problems.push(`${name}: sorts before its parent ${parent}`)
      }
    }
  }
  return problems.length === 0 ? undefined : problems.join('\n')
}

function drizzleKit(args: ReadonlyArray<string>, expected: string): string | undefined {
  const run = spawnSync(drizzleKitBin, [...args, '--output', 'json'], {
    cwd: packageDir,
    encoding: 'utf8',
    // A large drift report must surface, not fail with ENOBUFS.
    maxBuffer: 64 * 1024 * 1024
  })
  // A spawn failure (no drizzle-kit bin) leaves stdout unset despite its type.
  const stdout = run.error === undefined ? run.stdout : ''
  // `--output json` prints the envelope as the last stdout line.
  const envelopeLine = stdout.trim().split('\n').at(-1) ?? ''
  const status = Option.map(decodeEnvelope(envelopeLine), (envelope) => envelope.status)
  if (Option.getOrUndefined(status) === expected) {
    return undefined
  }
  return [`expected status ${expected}`, stdout, run.stderr, run.error?.message]
    .filter(Boolean)
    .join('\n')
}

const restoreRemedy =
  'Restore the named folders from git. Otherwise delete the unapplied migration and every later one, then run `pnpm run db:generate`.'

const gates: ReadonlyArray<Gate> = [
  { name: 'migration history', run: historyProblems, remedy: restoreRemedy },
  {
    name: 'drizzle-kit check',
    run: () => drizzleKit(['check'], 'ok'),
    remedy: restoreRemedy
  },
  {
    name: 'schema drift',
    run: () => drizzleKit(['generate', '--explain'], 'no_changes'),
    remedy:
      'Run `pnpm run db:generate` and commit the migration with the schema change.'
  }
]

// Gates run in order and stop at the first failure: a schema diff against a
// broken history only repeats that error under the wrong remedy.
let failed = false
for (const gate of gates) {
  const problems = gate.run()
  if (problems === undefined) {
    console.log(`${gate.name}: ok`)
    continue
  }
  failed = true
  console.error(`${gate.name} failed.\n${problems}\n${gate.remedy}`)
  break
}

process.exitCode = failed ? 1 : 0
