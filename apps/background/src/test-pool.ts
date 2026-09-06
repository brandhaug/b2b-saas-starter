import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult
} from 'cloudflare:test'
import { env } from 'cloudflare:workers'

import worker from './index.ts'
import { type Env } from './queue-consumer.ts'

/**
 * The scaffolding every `*.pool.test.ts` suite shares, so the next pool test
 * starts at `consume` instead of re-deriving the handler wiring: the worker's
 * real `queue` handler invoked the way the runtime invokes it (batch, env,
 * ctx), the D1 binding the pool provisioned from `wrangler.jsonc`, and the
 * committed migrations (a plain-data binding, installed by `vitest.config.ts`)
 * applied to that D1. Queue-specific fixtures — message builders, table
 * seeds — stay beside their suite.
 */

// SAFETY: `Sentry.withSentry` types the wrapped `queue` handler as
// (batch, env), but its queue instrumentation reads the runtime's third
// argument (`ctx.waitUntil`, instrumentQueue.ts), and production always
// passes one — the cast only restores the ExportedHandlerQueueHandler
// contract the wrapper's own type dropped, and the bind keeps the method's
// own receiver. No value changes hands.
// oxlint-disable-next-line effect/noAs -- see SAFETY above
const queueHandler = worker.queue.bind(worker) as ExportedHandlerQueueHandler<Env>

/** D1 hands text and integer columns back as strings, numbers, or null. */
export type PoolRow = Readonly<Record<string, string | number | null>>

/** The D1 binding the pool provisioned from `wrangler.jsonc`; always present under the pool. */
export function db(): D1Database {
  const binding = env.DB
  if (binding === undefined) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- a missing binding means the pool never started (wrangler.jsonc unreadable); there is no Effect channel to defect into from a promise-based helper, and no test could run past this
    throw new Error('expected the workers pool to provision the DB binding')
  }
  return binding
}

/** Runs one batch through the real `queue` handler and reports the runtime's ack/retry decision. */
// The pool's queue API is promise-based end to end (createMessageBatch, the
// handler, getQueueResult); suites wrap this in Effect.promise at the
// boundary, like every other promise step in the pool tests.
// oxlint-disable effect/noAsyncFunction
export async function consume<M>(
  queueName: string,
  messages: ReadonlyArray<ServiceBindingQueueMessage<M>>
): Promise<FetcherQueueResult> {
  const batch = createMessageBatch(queueName, [...messages])
  const ctx = createExecutionContext()
  await queueHandler(batch, env, ctx)
  return getQueueResult(batch, ctx)
}
// oxlint-enable effect/noAsyncFunction

/** Every row a query matches, in the store's own order. */
export function rows(
  query: string,
  ...params: ReadonlyArray<string>
): Promise<Array<PoolRow>> {
  return db()
    .prepare(query)
    .bind(...params)
    .all<PoolRow>()
    .then((result) => result.results)
}

/** The first row a query matches, or null — the one-row lookups suites assert on. */
export function row(
  query: string,
  ...params: ReadonlyArray<string>
): Promise<PoolRow | null> {
  return db()
    .prepare(query)
    .bind(...params)
    .first<PoolRow>()
}

/**
 * Applies the committed migrations to the pool's D1. Per-test-file storage
 * isolation gives each suite a fresh D1, so once per file is exactly right;
 * `applyD1Migrations` skips already-applied ones regardless.
 */
export function applyPoolMigrations(): Promise<void> {
  return applyD1Migrations(db(), env.TEST_MIGRATIONS).then(() => undefined)
}
