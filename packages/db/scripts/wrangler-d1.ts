// Shared `wrangler d1` run for the package's CLI scripts
// (scripts/migrate.ts, scripts/baseline.ts).
//
// Like those scripts, this is a Node CLI helper, not application code: it runs
// outside any Effect runtime, so the child-process wait is a plain promise.
//
// Failures are returned to the caller, not exited on here: in `--json` mode
// wrangler writes its error to *stdout*, which a captured run must surface
// — exiting on the bare code alone (the original shape) turned
// missing-database failures into a silent exit 1.
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { Option, Schema } from 'effect'
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

const execWrangler = promisify(execFile)

/**
 * A wrangler run that exited non-zero: Node attaches the captured streams and
 * the exit code to the rejection. A spawn failure (no wrangler bin) carries a
 * string `errno` code and neither stream instead, so it fails this decode and
 * falls back to the error message.
 */
const ExecFileFailure = Schema.Struct({
  // A signal kill leaves `code` null and a maxBuffer kill sets a string errno;
  // the streams must still be surfaced in both cases, so `code` is decoded apart.
  code: Schema.optionalKey(Schema.Unknown),
  stdout: Schema.optionalKey(Schema.String),
  stderr: Schema.optionalKey(Schema.String)
})
const decodeExecFileFailure = Schema.decodeUnknownOption(ExecFileFailure)
const decodeExitCode = Schema.decodeUnknownOption(Schema.Number)

async function runWrangler(
  args: ReadonlyArray<string>,
  capture: boolean
): Promise<WranglerRun> {
  const wranglerArgs = ['d1', ...args]
  if (!capture) {
    // An uncaptured run is the caller's console output; nothing parses it, so
    // wrangler streams straight through and only the exit code comes back.
    try {
      const child = spawn(wranglerBin, wranglerArgs, { stdio: 'inherit' })
      const [code] = await once(child, 'exit')
      const exitCode = Option.getOrElse(decodeExitCode(code), () => 1)
      return exitCode === 0
        ? { ok: true, stdout: '' }
        : { ok: false, code: exitCode, output: '' }
    } catch (error) {
      return {
        ok: false,
        code: 1,
        output: errorMessage(error) ?? 'wrangler failed to spawn'
      }
    }
  }
  try {
    const { stdout } = await execWrangler(wranglerBin, wranglerArgs, {
      // Migration and export output far exceeds the 1 MiB default.
      maxBuffer: 64 * 1024 * 1024
    })
    return { ok: true, stdout }
  } catch (error) {
    const spawned = Option.getOrUndefined(decodeExecFileFailure(error))
    const code = Option.getOrElse(decodeExitCode(spawned?.code), () => 1)
    const output = [spawned?.stderr, spawned?.stdout].filter(Boolean).join('\n')
    if (output === '') {
      return {
        ok: false,
        code,
        output: errorMessage(error) ?? 'wrangler failed to spawn'
      }
    }
    return { ok: false, code, output }
  }
}

/**
 * Executes SQL against a D1 database. `args` carries the target
 * (`--local` / `--remote`) and the payload (`--command=…` / `--file=…`).
 * A remote target is passed to wrangler by uuid, a local one by name (see
 * `remoteDatabaseId`). When `captureJson` is set the `--json` output — and,
 * on failure, wrangler's error, which json mode writes to stdout — is
 * captured for the caller; otherwise wrangler inherits this process's stdio,
 * streams straight through, and `stdout` comes back empty.
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

// The account's database list, fetched at most once per process: baseline
// issues one execute per unrecorded migration, and re-listing the account for
// each would only add latency. A CLI script's process is too short for the
// cache to go stale. The raw JSON is what is cached, so the one decoder below
// stays the only reader of wrangler's shape.
let databaseListJson: Promise<string> | undefined

function fetchDatabaseListJson(): Promise<string> {
  databaseListJson ??= runWrangler(['list', '--json'], true).then((run) => {
    if (!run.ok) {
      throw new Error(`wrangler d1 list failed (exit ${run.code}):\n${run.output}`)
    }
    return run.stdout
  })
  return databaseListJson
}

/**
 * The uuid of one database in `wrangler d1 list --json` output, by name.
 *
 * Exported because `scripts/d1-backup.ts` resolves the same uuid from its own
 * wrangler spawn (a different bin, config, and retry wrapper), and the decode,
 * the lookup, and the "which database" error message are the part that must
 * not drift between the two.
 */
export function remoteDatabaseIdFromList(listJson: string, database: string): string {
  const found = decodeDatabases(listJson).find((entry) => entry.name === database)
  if (found === undefined) {
    throw new Error(`no D1 database named '${database}' exists in the account`)
  }
  return found.uuid
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
  return remoteDatabaseIdFromList(await fetchDatabaseListJson(), database)
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
  const databases = decodeDatabases(await fetchDatabaseListJson())
  return databases.map((database) => database.name)
}
