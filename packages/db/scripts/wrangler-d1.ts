// Shared `wrangler d1 execute` spawn for the package's CLI scripts
// (scripts/migrate.ts, scripts/baseline.ts).
//
// Like those scripts, this is a Node CLI helper, not application code: it
// runs outside any Effect runtime, so the child-process wait is an ordinary
// Promise — the one place `new Promise` appears, carrying the
// effect/noNewPromise waiver for every caller (see migrate.ts's header).
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const packageDir = join(import.meta.dirname, '..')
// The wrangler bin of this package's own node_modules (pnpm writes every direct
// dependency's bin there), so the spawn never reaches for a global install.
const wranglerBin = join(packageDir, 'node_modules', '.bin', 'wrangler')

/** One D1 a script targets, and how: by name, locally or remote. */
export type Target = {
  readonly database: string
  readonly flag: '--local' | '--remote'
}

/**
 * Executes SQL against a D1 database by name. `args` carries the target
 * (`--local` / `--remote`) and the payload (`--command=…` / `--file=…`).
 * Wrangler's stderr always streams through; stdout is piped only when the
 * caller needs to decode the `--json` output.
 */
export function wranglerD1Execute(
  database: string,
  args: ReadonlyArray<string>,
  captureJson: boolean
): Promise<string> {
  // Plain Node CLI helper, not Effect code (see the header) — the
  // child-process wait is an ordinary Promise, which is why
  // effect/noNewPromise is waived.
  // oxlint-disable-next-line effect/noNewPromise -- see above
  return new Promise((resolve) => {
    const child = spawn(
      wranglerBin,
      [
        'd1',
        'execute',
        database,
        `--config=${join(packageDir, 'wrangler.jsonc')}`,
        ...args,
        ...(captureJson ? ['--json'] : [])
      ],
      { stdio: ['ignore', captureJson ? 'pipe' : 'inherit', 'inherit'] }
    )
    let stdoutText = ''
    if (captureJson && child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutText += chunk
      })
    }
    child.on('exit', (code) => {
      if (code !== 0) {
        process.exit(code ?? 1)
      }
      resolve(stdoutText)
    })
    child.on('error', (error) => {
      console.error(error)
      process.exit(1)
    })
  })
}
