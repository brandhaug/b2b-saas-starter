// Applies drizzle-kit's folder-style migrations (migrations/<name>/migration.sql)
// to the D1 database via `wrangler d1 execute`. Wrangler's own migrations runner
// (`wrangler d1 migrations apply`) only sees flat `migrations/*.sql` files, so it
// reports "No migrations to apply" for drizzle-kit rc output — hence this script.
//
// Tracking uses the same `d1_migrations` table (name + applied_at) wrangler's
// runner would create, so already-applied migrations are skipped on re-run.
//
// Usage: bun scripts/migrate.ts [--remote]   (defaults to --local)
//
// This is a Bun CLI entry point, not application code: it runs outside any Effect
// runtime, its whole job is to spawn `wrangler` and shuttle files, and its exit
// code is the contract with the `db:migrate:*` package scripts. There is no
// Effect runtime to read Config/Stdio/FileSystem/Command from here.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { listMigrations } from '../src/migrations-fs.ts'

const packageDir = join(import.meta.dir, '..')

function resolveTarget(argv: readonly string[]): '--remote' | '--local' {
  if (argv.includes('--remote')) return '--remote'
  return '--local'
}

const target = resolveTarget(process.argv)

function jsonFlags(captureJson: boolean): string[] {
  if (captureJson) return ['--json']
  return []
}

function stdoutMode(captureJson: boolean): 'pipe' | 'inherit' {
  if (captureJson) return 'pipe'
  return 'inherit'
}

async function readStdout(
  stdout: ReadableStream<Uint8Array> | undefined,
  captureJson: boolean
): Promise<string> {
  if (!captureJson) return ''
  return new Response(stdout).text()
}

async function wranglerExecute(args: string[], captureJson: boolean) {
  const proc = Bun.spawn(
    [
      'bunx',
      'wrangler',
      'd1',
      'execute',
      'b2b-saas-starter',
      target,
      `--config=${join(packageDir, 'wrangler.jsonc')}`,
      ...args,
      ...jsonFlags(captureJson)
    ],
    { stdout: stdoutMode(captureJson), stderr: 'inherit' }
  )
  const stdout = await readStdout(proc.stdout, captureJson)
  const code = await proc.exited
  if (code !== 0) {
    process.exit(code)
  }
  return stdout
}

// Wrangler's `--json` output for a SELECT: one batch per statement. Decoding it
// instead of casting means a wrangler output change fails here, loudly, rather
// than producing an empty applied-set and re-running every migration.
const AppliedMigrationsJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      results: Schema.Array(Schema.Struct({ name: Schema.String }))
    })
  )
)

const migrations = listMigrations()

await wranglerExecute(
  [
    '--command=CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ],
  true
)

const appliedJson = await wranglerExecute(
  ['--command=SELECT name FROM d1_migrations'],
  true
)
const applied = new Set<string>(
  Schema.decodeUnknownSync(AppliedMigrationsJson)(appliedJson).flatMap((batch) =>
    batch.results.map((row) => row.name)
  )
)

const pending = migrations.filter(({ name }) => !applied.has(name))
if (pending.length === 0) {
  console.log(
    `No migrations to apply (${migrations.length} already applied, ${target}).`
  )
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'd1-migrate-'))
for (const { name, sql } of pending) {
  console.log(`Applying ${name} (${target})...`)
  // Record the migration in the same batch that applies it, so a failed
  // migration is never marked as applied.
  const file = join(tmp, `${name}.sql`)
  await Bun.write(file, `${sql}\nINSERT INTO d1_migrations(name) VALUES ('${name}');\n`)
  await wranglerExecute([`--file=${file}`], false)
}

console.log(`Applied ${pending.length} migration(s).`)
