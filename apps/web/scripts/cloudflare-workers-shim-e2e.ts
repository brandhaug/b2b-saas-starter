import type * as LocalWorkerRuntime from './local-worker-runtime.mjs'
/* oxlint-disable effect/noNodeBuiltinImport -- Node preview startup precedes the application Effect runtime. */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { env as baseEnv } from '../src/lib/cloudflare-workers-shim.ts'

const moduleUrl = pathToFileURL(
  resolve(process.cwd(), 'scripts/local-worker-runtime.mjs')
).href
const runtime: typeof LocalWorkerRuntime = await import(/* @vite-ignore */ moduleUrl)
const bindings = await runtime.localWorkerBindings()
if (bindings === undefined) {
  // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- fail before serving requests against absent test state
  throw new Error(
    'Built E2E preview requires migrated local D1. Run pnpm run db:migrate:local first.'
  )
}
export const env = { ...baseEnv, ...bindings }
