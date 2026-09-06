import { type WorkspaceExportQueueMessage } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { workspaceExportQueueName } from '../../../infra/bindings.ts'
import { env } from 'cloudflare:workers'
import { Effect } from 'effect'
import { beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'

import { applyPoolMigrations, consume, db, row, rows } from './test-pool.ts'

// The export consumer's queue-runtime contract (ADR 0055), inside workerd
// through `@cloudflare/vitest-pool-workers`: real D1 (the committed
// migrations), the real R2 bucket from `wrangler.jsonc`, and real acks —
// asserted with `getQueueResult()`. Exports have no dead-letter queue: the
// row is the record, so both a completed and a failed build end in an ack,
// with the row carrying the outcome. No async functions on purpose — the
// Effect lint rules ban them, so promise steps ride `Effect.promise` inside
// `Effect.runPromise`, like the live suites in `packages/auth`.

const WORKSPACE_ID = 'ws_export'
const WORKSPACE_SLUG = 'pool-exports'
const EXPORT_ID = 'wexp_pool'
const OBJECT_KEY = `workspaces/${WORKSPACE_ID}/${EXPORT_ID}.json.gz`

/** The R2 binding the pool provisioned from `wrangler.jsonc`; always present under the pool. */
function bucket() {
  const binding = env.WORKSPACE_EXPORT_BUCKET
  if (binding === undefined) {
    throw new Error('expected the workers pool to provision the bucket binding')
  }
  return binding
}

/** One export job message, addressed by the slug the consumer must re-resolve. */
function exportMessage(
  slug: string
): ServiceBindingQueueMessage<WorkspaceExportQueueMessage> {
  return {
    id: EXPORT_ID,
    // The platform's message shape carries a plain Date; `DateTime` has no
    // place in a value vitest serializes into the batch.
    // oxlint-disable-next-line effect/noGlobals -- platform message field, not application time
    timestamp: new Date(1000),
    attempts: 1,
    body: {
      exportId: EXPORT_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSlug: slug
    }
  }
}

/** Clears the tables the export touches and seeds one workspace with a pending export row. */
function seedPendingExport(): Promise<void> {
  return db()
    .batch([
      db().prepare('delete from workspace_exports'),
      db().prepare('delete from webhook_deliveries'),
      db().prepare('delete from audit_events'),
      db().prepare('delete from notifications'),
      db().prepare('delete from webhook_endpoints'),
      db().prepare('delete from api_tokens'),
      db().prepare('delete from workspace_invitations'),
      db().prepare('delete from workspace_members'),
      db().prepare('delete from workspaces'),
      db()
        .prepare('insert into workspaces (id, name, slug) values (?, ?, ?)')
        .bind(WORKSPACE_ID, 'Pool Exports', WORKSPACE_SLUG),
      db()
        .prepare(
          `insert into workspace_exports
           (id, workspace_id, status, download_secret, created_at)
         values (?, ?, ?, ?, ?)`
        )
        .bind(
          EXPORT_ID,
          WORKSPACE_ID,
          'pending',
          'wsec_pool',
          '2026-09-06T00:00:00.000Z'
        )
    ])
    .then(() => undefined)
}

describe('workspace export consumer (workers pool)', () => {
  // oxlint-disable-next-line effect/noTestLifecycleHooks -- applies the committed migrations to the pool's D1
  beforeAll(() => applyPoolMigrations())
  // oxlint-disable-next-line effect/noTestLifecycleHooks -- resets D1 between outcomes
  beforeEach(() => seedPendingExport())

  it('acks a finished export after storing the archive and flipping the row ready', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          consume(workspaceExportQueueName, [exportMessage(WORKSPACE_SLUG)])
        )
        expect(result.explicitAcks).toStrictEqual([EXPORT_ID])
        expect(result.retryMessages).toStrictEqual([])
        const exportRow = yield* Effect.promise(() =>
          row('select * from workspace_exports where id = ?', EXPORT_ID)
        )
        expect(exportRow?.workspace_id).toBe(WORKSPACE_ID)
        expect(exportRow?.status).toBe('ready')
        expect(exportRow?.object_key).toBe(OBJECT_KEY)
        expect(exportRow?.completed_at).not.toBeNull()
        const sizeBytes = exportRow?.size_bytes
        expect(sizeBytes).toBeGreaterThan(0)
        // The bytes the row points at exist in the bucket the pool bound.
        const object = yield* Effect.promise(() => bucket().get(OBJECT_KEY))
        expect(object).not.toBeNull()
        expect(object?.size).toBe(sizeBytes)
        // The completion is audited beside the row flip.
        const audit = yield* Effect.promise(() =>
          rows(
            'select * from audit_events where event_type = ?',
            'workspace.export_completed'
          )
        )
        expect(audit).toHaveLength(1)
        expect(audit[0]?.workspace_id).toBe(WORKSPACE_ID)
        expect(audit[0]?.target_type).toBe('workspace_export')
        expect(audit[0]?.target_id).toBe(EXPORT_ID)
      })
    ))

  it('acks an export whose slug no longer resolves, marking the row failed', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          consume(workspaceExportQueueName, [exportMessage('deleted-slug')])
        )
        // No dead-letter queue for exports: a build that cannot even start
        // still acks, and the row carries the outcome.
        expect(result.explicitAcks).toStrictEqual([EXPORT_ID])
        expect(result.retryMessages).toStrictEqual([])
        const exportRow = yield* Effect.promise(() =>
          row('select * from workspace_exports where id = ?', EXPORT_ID)
        )
        expect(exportRow?.status).toBe('failed')
        expect(exportRow?.failure_reason).toBe('workspace_not_found')
        expect(exportRow?.object_key).toBeNull()
        expect(exportRow?.completed_at).toBeNull()
        // The row points at no archive: nothing was ever built or stored for
        // this export (the ready test above proves the write path works).
      })
    ))
})
