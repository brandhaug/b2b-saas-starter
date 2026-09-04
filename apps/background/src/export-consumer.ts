import {
  selectCapabilitiesLayer,
  selectWorkspaceContextLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  type CapabilityUnavailable,
  type WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import { buildWorkspaceExportArchive } from '@b2b-saas-starter/capabilities/governance/workspace-export-archive'
import {
  collectWorkspaceExportSnapshot,
  type WorkspaceExportSnapshotServices
} from '@b2b-saas-starter/capabilities/governance/workspace-export-snapshot'
import {
  WorkspaceExportQueueMessage,
  WorkspaceExports
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { DateTime, Effect, type Layer, Result, Schema, type Scope } from 'effect'

import { workspaceExportConsumerSettings } from '../../../infra/bindings.ts'
import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  queueDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'
/**
 * The workspace export consumer (ADR 0055). One message names one `pending`
 * export row; the consumer resolves the workspace the way a request would,
 * snapshots it through the capability services, builds the archive, and hands
 * the bytes to `WorkspaceExports.complete`, which stores them, flips the row,
 * audits, and notifies the requester.
 *
 * Same boundary shape as `webhook-consumer.ts`: the untrusted body is decoded
 * once (`readExportDelivery`), a malformed body is terminal, and the
 * orchestration is exported with its requirements open so tests inject stub
 * layers — `processWorkspaceExportMessage` takes the workspace resolver as an
 * argument for the same reason.
 */

const decodeMessage = Schema.decodeUnknownResult(WorkspaceExportQueueMessage)

/** Wire shape of export queue messages — the schema is shared with the producer. */
export type WorkspaceExportMessage = typeof WorkspaceExportQueueMessage.Type

/**
 * The boundary decode: platform fields plus the message, or the terminal
 * `malformed` outcome — the same `queueDelivery` vocabulary every consumer in
 * this worker shares, so the envelope's id and attempt count ride along.
 */
export function readExportDelivery(
  envelope: QueueEnvelope
): QueueDelivery<WorkspaceExportMessage> {
  return queueDelivery(envelope, decodeMessage(envelope.body))
}

/**
 * How the consumer turns a slug into a trusted `WorkspaceContext` (no actor —
 * the queue message is the authorization; the requester was checked at request
 * time). The handler passes `selectWorkspaceContextLayer`; tests pass
 * `testWorkspaceContext`.
 */
export type ResolveWorkspace = (
  slug: string
) => Layer.Layer<WorkspaceContext, WorkspaceNotFound | CapabilityUnavailable>

/**
 * Whether a store failure should be retried or is the message's last chance.
 * The queue's `maxRetries` is the source; a message on its final attempt is
 * marked failed so the requester is not left waiting on a row that never moves.
 */
function isLastAttempt(attempts: number): boolean {
  return attempts >= workspaceExportConsumerSettings.maxRetries
}

/**
 * Builds one export. Outcomes:
 * - archive stored, row `ready` → ack;
 * - malformed body, unknown slug, or a slug that no longer names the message's
 *   workspace → the row is marked `failed` where one exists, ack;
 * - the store is unreachable → retry, or mark failed on the last attempt.
 */
export function processWorkspaceExportMessage(
  delivery: QueueDelivery<WorkspaceExportMessage>,
  resolveWorkspace: ResolveWorkspace
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable,
  WorkspaceExports | WorkspaceExportSnapshotServices | Scope.Scope
> {
  return Effect.gen(function* () {
    if (delivery.kind === 'malformed') {
      yield* Effect.annotateLogsScoped({
        outcome: 'failed',
        skipReason: 'malformed_message'
      })
      return 'ack' satisfies DeliveryOutcome
    }
    const message = delivery.message
    yield* Effect.annotateLogsScoped({
      exportId: message.exportId,
      workspaceId: message.workspaceId,
      workspaceSlug: message.workspaceSlug
    })
    const exports = yield* WorkspaceExports

    const built = yield* Effect.result(
      Effect.gen(function* () {
        const snapshot = yield* collectWorkspaceExportSnapshot({
          exportId: message.exportId,
          generatedAt: yield* DateTime.now
        })
        // The slug resolved a workspace, but is it still the one that asked?
        // A workspace deleted and re-created under the same slug must not
        // receive the old request's archive.
        if (snapshot.workspace.id !== message.workspaceId) {
          return null
        }
        return buildWorkspaceExportArchive(snapshot)
      }).pipe(Effect.provide(resolveWorkspace(message.workspaceSlug)))
    )

    if (Result.isFailure(built)) {
      const failure = built.failure
      if (failure._tag === 'WorkspaceNotFound') {
        yield* exports.fail({
          exportId: message.exportId,
          workspaceId: message.workspaceId,
          reason: 'workspace_not_found'
        })
        yield* Effect.annotateLogsScoped({
          outcome: 'failed',
          skipReason: 'workspace_not_found'
        })
        return 'ack' satisfies DeliveryOutcome
      }
      if (isLastAttempt(delivery.attempts)) {
        yield* exports.fail({
          exportId: message.exportId,
          workspaceId: message.workspaceId,
          reason: `unavailable: ${failure.reason}`
        })
        yield* Effect.annotateLogsScoped({
          outcome: 'failed',
          skipReason: 'retries_exhausted'
        })
        return 'ack' satisfies DeliveryOutcome
      }
      yield* Effect.annotateLogsScoped({
        outcome: 'retry',
        capabilityReason: failure.reason
      })
      return 'retry' satisfies DeliveryOutcome
    }

    if (built.success === null) {
      yield* exports.fail({
        exportId: message.exportId,
        workspaceId: message.workspaceId,
        reason: 'workspace_mismatch'
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'failed',
        skipReason: 'workspace_mismatch'
      })
      return 'ack' satisfies DeliveryOutcome
    }

    const completed = yield* exports.complete({
      exportId: message.exportId,
      workspaceId: message.workspaceId,
      archive: built.success
    })
    let outcome = 'skipped'
    if (completed) {
      outcome = 'ready'
    }
    yield* Effect.annotateLogsScoped({ outcome, sizeBytes: built.success.length })
    return 'ack' satisfies DeliveryOutcome
  })
}

/**
 * Consumer entry: the real capability layer, the request-shaped workspace
 * resolver, and the wide-event scope. A defect or an unhandled store failure
 * retries — the queue's `maxRetries` bounds it and the last attempt marks the
 * row failed inside `processWorkspaceExportMessage`.
 */
export function buildWorkspaceExport(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readExportDelivery(envelope)
  const capabilitiesEnv = starterEnv(env)
  return consumerInvocation(env, {
    event: 'workspace_export',
    delivery,
    onFailure: 'retry',
    program: processWorkspaceExportMessage(delivery, (slug) =>
      selectWorkspaceContextLayer(capabilitiesEnv, slug)
    ).pipe(Effect.provide(selectCapabilitiesLayer(capabilitiesEnv)))
  })
}
