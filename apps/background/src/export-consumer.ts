import {
  selectCapabilitiesLayer,
  selectWorkspaceContextLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  WorkspaceExportGeneration,
  WorkspaceExportGenerationLayer,
  type WorkspaceExportGenerationResult
} from '@b2b-saas-starter/capabilities/governance/workspace-export-generation'
import { WorkspaceExportQueueMessage } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, Layer, type Scope } from 'effect'

import { workspaceExportConsumerSettings } from '@b2b-saas-starter/infra'
import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

/**
 * The workspace export consumer (ADR 0055). One message names one `pending`
 * export row; the capability-owned generation workflow resolves the workspace,
 * snapshots it, builds the archive, and settles the row.
 *
 * The queue adapter decodes the untrusted body once, supplies tracing, selects
 * the trusted workspace resolver, and keeps the platform retry schedule. It
 * does not know snapshot dependencies or generation failure policy.
 */
export function processWorkspaceExportMessage(
  delivery: QueueDelivery<WorkspaceExportQueueMessage>,
  generationLayer: Layer.Layer<WorkspaceExportGeneration, never, never>
): Effect.Effect<DeliveryOutcome, CapabilityUnavailable, Scope.Scope> {
  const program = Effect.gen(function* () {
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
    const generation = yield* WorkspaceExportGeneration
    const result = yield* generation.generate({
      message,
      finalAttempt: delivery.attempts >= workspaceExportConsumerSettings.maxRetries
    })
    yield* annotateGenerationResult(result)
    if (result._tag === 'retry') {
      return 'retry' satisfies DeliveryOutcome
    }
    return 'ack' satisfies DeliveryOutcome
  }).pipe(Effect.provide(generationLayer))

  return program
}

function annotateGenerationResult(result: WorkspaceExportGenerationResult) {
  if (result._tag === 'ready') {
    return Effect.annotateLogsScoped({ outcome: 'ready', sizeBytes: result.sizeBytes })
  }
  if (result._tag === 'retry') {
    return Effect.annotateLogsScoped({
      outcome: 'retry',
      capabilityReason: result.reason
    })
  }
  return Effect.annotateLogsScoped({ outcome: 'skipped', skipReason: result.reason })
}

/**
 * Consumer entry: the real capability layer, the request-shaped workspace
 * resolver, and the wide-event scope. Generation returns a retry disposition
 * while attempts remain; terminal persistence failures remain Effect failures
 * so the platform can retry rather than falsely acknowledging the job.
 */
export function buildWorkspaceExport(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(WorkspaceExportQueueMessage, envelope)
  const capabilitiesEnv = starterEnv(env)
  const generationLayer = WorkspaceExportGenerationLayer((slug) =>
    selectWorkspaceContextLayer(capabilitiesEnv, slug, undefined, 'system')
  ).pipe(Layer.provide(selectCapabilitiesLayer(capabilitiesEnv)))

  return consumerInvocation(env, {
    event: 'workspace_export',
    delivery,
    onFailure: 'retry',
    program: processWorkspaceExportMessage(delivery, generationLayer)
  })
}
