// Shared `wrangler d1` spawn for the package's CLI scripts
// (scripts/migrate.ts, scripts/baseline.ts).
//
// Like those scripts, this is a Node CLI helper, not application code: it
// runs outside any Effect runtime, so the child-process wait is an ordinary
// Promise — the one place `new Promise` appears, carrying the
// effect/noNewPromise waiver for every caller (see migrate.ts's header).
//
// Failures are returned to the caller, not exited on here: in `--json` mode
// wrangler writes its error to *stdout*, which a captured run must surface
// — exiting on the bare code alone (the original shape) turned
// missing-database failures into a silent exit 1.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Schema } from 'effect'
import { errorMessage } from '@b2b-saas-starter/failure'

const packageDir = join(import.meta.dirname, '..')
// The wrangler bin of this package's own node_modules (pnpm writes every direct
// dependency's bin there), so the spawn never reaches for a global install.
const wranglerBin = join(packageDir, 'node_modules', '.bin', 'wrangler')

/** One completed wrangler run: stdout on success, code + output on failure. */
export type WranglerRun =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly code: number; readonly output: string }

/** One D1 a script targets, and how: by name, locally or remote. */
export type Target = {
  readonly database: string
  readonly flag: '--local' | '--remote'
}

function runWrangler(
  args: ReadonlyArray<string>,
  capture: boolean
): Promise<WranglerRun> {
  // Plain Node CLI helper, not Effect code (see the header) — the
  // child-process wait is an ordinary Promise, which is why
  // effect/noNewPromise is waived.
  // oxlint-disable-next-line effect/noNewPromise -- see above
  return new Promise((resolve) => {
    const child = spawn(wranglerBin, ['d1', ...args], {
      stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit']
    })
    let stdoutText = ''
    let stderrText = ''
    if (capture && child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutText += chunk
      })
    }
    if (capture && child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrText += chunk
      })
    }
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout: stdoutText })
      } else {
        resolve({
          ok: false,
          code: code ?? 1,
          output: [stderrText, stdoutText].filter(Boolean).join('\n')
        })
      }
    })
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: 1,
        output: errorMessage(error) ?? 'wrangler failed to spawn'
      })
    })
  })
}

/**
 * Executes SQL against a D1 database. `args` carries the target
 * (`--local` / `--remote`) and the payload (`--command=…` / `--file=…`).
 * A remote target is passed to wrangler by uuid, a local one by name (see
 * `remoteDatabaseId`). When `captureJson` is set the `--json` output — and,
 * on failure, wrangler's error, which json mode writes to stdout — is
 * captured for the caller; otherwise wrangler streams straight through and
 * `stdout` comes back empty.
 */
export async function wranglerD1Execute(
  database: string,
  args: ReadonlyArray<string>,
  captureJson: boolean
): Promise<WranglerRun> {
  const target = args.includes('--remote') ? await remoteDatabaseId(database) : database
  return runWrangler(
    [
      'execute',
      target,
      `--config=${join(packageDir, 'wrangler.jsonc')}`,
      ...args,
      ...(captureJson ? ['--json'] : [])
    ],
    captureJson
  )
}

// Decoding instead of casting means a wrangler output change fails here,
// loudly, rather than producing an empty database list (which baseline.ts
// would read as "nothing deployed, skip everything").
const DatabasesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ name: Schema.String, uuid: Schema.String }))
)
const decodeDatabases = Schema.decodeUnknownSync(DatabasesJson)

type RemoteDatabase = { readonly name: string; readonly uuid: string }

// The account's database list, fetched at most once per process: baseline
// issues one execute per unrecorded migration, and re-listing the account for
// each would only add latency. A CLI script's process is too short for the
// cache to go stale.
let databasesFetched: Promise<ReadonlyArray<RemoteDatabase>> | undefined

function fetchDatabases(): Promise<ReadonlyArray<RemoteDatabase>> {
  databasesFetched ??= runWrangler(['list', '--json'], true).then((run) => {
    if (!run.ok) {
      throw new Error(`wrangler d1 list failed (exit ${run.code}):\n${run.output}`)
    }
    return decodeDatabases(run.stdout)
  })
  return databasesFetched
}

/**
 * The uuid of one remote D1 database, by name. Wrangler would resolve a bare
 * name through the account API — but only when no `d1_databases` binding in
 * the config claims that name, and this package's wrangler.jsonc does claim
 * it with a placeholder `database_id` that wrangler then uses verbatim. A
 * uuid matches no binding, so wrangler's own lookup lands on the real
 * database. Local mode needs no resolution: without `--remote` wrangler keys
 * its local state by the binding's placeholder id and never calls the API.
 */
async function remoteDatabaseId(database: string): Promise<string> {
  const databases = await fetchDatabases()
  const found = databases.find((entry) => entry.name === database)
  if (found === undefined) {
    throw new Error(`no D1 database named '${database}' exists in the account`)
  }
  return found.uuid
}

/**
 * Every D1 database name in the account, via `wrangler d1 list --json` (auth
 * from the usual CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID env). Throws on
 * failure: an unreadable account must never read as "no databases". Stage
 * databases are destroyed with their PRs, so the account stays well under
 * wrangler's page size; a false "missing" would fail the deploy loudly at
 * `CREATE TABLE`, not silently skip schema.
 */
export async function listRemoteDatabases(): Promise<ReadonlyArray<string>> {
  const databases = await fetchDatabases()
  return databases.map((database) => database.name)
}
