import { Effect } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceSuspended } from './workspace-suspension.ts'
import { type ContractExpect } from './contract-expect.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { WorkspaceExports } from './workspace-export.ts'

/**
 * The export contract, written once and run against both adapters —
 * capabilities invariant 4.
 *
 * Only the part of the lifecycle both adapters own lives here. The artifact
 * half does not: Live writes bytes to R2 after a queue round trip, Seed
 * builds them inline, and each suite covers its own. What is shared is the
 * state machine every caller sees — what `request` hands back, what settles a
 * pending export, and what a settled one refuses.
 */

export type WorkspaceExportContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | WorkspaceSuspended,
    WorkspaceExports | AuditEventLog | WorkspaceContext
  >
}

export function workspaceExportContractCases(
  expect: ContractExpect
): ReadonlyArray<WorkspaceExportContractCase> {
  return [
    {
      name: 'reports the export surface as available',
      assert: Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        expect((yield* exports.availability).available).toBe(true)
      })
    },
    {
      // `request` hands back the row it just wrote, and that row is pending:
      // the artifact does not exist yet whichever adapter is answering. A
      // Seed adapter returning `ready` would let the UI skip the progress
      // state it must render against a real deployment.
      name: 'request hands back a pending export that then appears in list',
      assert: Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        const requested = yield* exports.request
        expect(requested.status).toBe('pending')
        expect(requested.completedAt).toBe(null)
        expect(requested.expiresAt).toBe(null)
        expect(requested.sizeBytes).toBe(null)
        expect(requested.failureReason).toBe(null)

        const listed = yield* exports.list
        expect(listed.some((each) => each.id === requested.id)).toBe(true)
      })
    },
    {
      // Settling is once-only on both sides, and the settlement is audited:
      // a failed export is the outcome an operator most needs a trail for.
      name: 'fail settles a pending export once and audits it',
      assert: Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        const log = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        const requested = yield* exports.request

        expect(
          yield* exports.fail({
            exportId: requested.id,
            workspaceId: ctx.workspace.id,
            reason: 'contract_settlement'
          })
        ).toBe(true)
        // Settled: a second attempt finds nothing pending and writes nothing.
        expect(
          yield* exports.fail({
            exportId: requested.id,
            workspaceId: ctx.workspace.id,
            reason: 'contract_settlement'
          })
        ).toBe(false)

        const events = yield* log.list({ eventType: 'workspace.export_failed' })
        expect(
          events.items.filter(
            (event) =>
              event.targetId === requested.id && event.targetType === 'workspace_export'
          ).length
        ).toBe(1)
      })
    },
    {
      name: 'fail refuses an export of another workspace or one never requested',
      assert: Effect.gen(function* () {
        const exports = yield* WorkspaceExports
        const requested = yield* exports.request
        expect(
          yield* exports.fail({
            exportId: requested.id,
            workspaceId: 'wrk_not_this_one',
            reason: 'contract_foreign'
          })
        ).toBe(false)
        expect(
          yield* exports.fail({
            exportId: 'exp_never_requested',
            workspaceId: (yield* WorkspaceContext).workspace.id,
            reason: 'contract_missing'
          })
        ).toBe(false)
      })
    }
  ]
}
