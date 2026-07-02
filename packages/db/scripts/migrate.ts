// Applies drizzle-kit's folder-style migrations (migrations/<name>/migration.sql)
// to the D1 database via `wrangler d1 execute`. Wrangler's own migrations runner
// (`wrangler d1 migrations apply`) only sees flat `migrations/*.sql` files, so it
// reports "No migrations to apply" for drizzle-kit rc output — hence this script.
//
// Tracking uses the same `d1_migrations` table (name + applied_at) wrangler's
// runner would create, so already-applied migrations are skipped on re-run.
//
// Usage: bun scripts/migrate.ts [--remote]   (defaults to --local)
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packageDir = join(import.meta.dir, '..')
const migrationsDir = join(packageDir, 'migrations')
const target = process.argv.includes('--remote') ? '--remote' : '--local'

const wranglerExecute = async (args: string[], captureJson: boolean) => {
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
      ...(captureJson ? ['--json'] : [])
    ],
    { stdout: captureJson ? 'pipe' : 'inherit', stderr: 'inherit' }
  )
  const stdout = captureJson ? await new Response(proc.stdout).text() : ''
  const code = await proc.exited
  if (code !== 0) {
    process.exit(code)
  }
  return stdout
}

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

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
  (JSON.parse(appliedJson) as Array<{ results: Array<{ name: string }> }>).flatMap(
    (batch) => batch.results.map((row) => row.name)
  )
)

const pending = migrations.filter((name) => !applied.has(name))
if (pending.length === 0) {
  console.log(
    `No migrations to apply (${migrations.length} already applied, ${target}).`
  )
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'd1-migrate-'))
for (const name of pending) {
  console.log(`Applying ${name} (${target})...`)
  const sql = await Bun.file(join(migrationsDir, name, 'migration.sql')).text()
  // Record the migration in the same batch that applies it, so a failed
  // migration is never marked as applied.
  const file = join(tmp, `${name}.sql`)
  await Bun.write(file, `${sql}\nINSERT INTO d1_migrations(name) VALUES ('${name}');\n`)
  await wranglerExecute([`--file=${file}`], false)
}

console.log(`Applied ${pending.length} migration(s).`)
