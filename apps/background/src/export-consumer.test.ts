import {
  WorkspaceExportGeneration,
  type WorkspaceExportGenerationInterface,
  type WorkspaceExportGenerationResult,
  type WorkspaceExportGenerationInput
} from '@b2b-saas-starter/capabilities/governance/workspace-export-generation'
import {
  WORKSPACE_EXPORT_RETENTION_DAYS as CAPABILITY_RETENTION_DAYS,
  workspaceExportExpiresAt,
  WorkspaceExportQueueMessage
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { describe, expect, it } from '@effect/vitest'
import { DateTime, Effect, Layer } from 'effect'

import {
  WORKSPACE_EXPORT_RETENTION_DAYS,
  workspaceExportConsumerSettings
} from '../../../infra/bindings.ts'
import { processWorkspaceExportMessage } from './export-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

const message: WorkspaceExportQueueMessage = {
  exportId: 'exp_1',
  workspaceId: 'wrk_1',
  workspaceSlug: 'lab'
}

function generationLayer(
  result: WorkspaceExportGenerationResult,
  seen: Array<WorkspaceExportGenerationInput> = []
): Layer.Layer<WorkspaceExportGeneration> {
  const service: WorkspaceExportGenerationInterface = {
    generate: (input) =>
      Effect.sync(() => {
        seen.push(input)
        return result
      })
  }
  return Layer.succeed(WorkspaceExportGeneration)(service)
}

function run(
  body: unknown,
  result: WorkspaceExportGenerationResult,
  attempts = 1,
  seen: Array<WorkspaceExportGenerationInput> = []
) {
  return processWorkspaceExportMessage(
    readDelivery(WorkspaceExportQueueMessage, {
      id: 'qmsg_export',
      body,
      attempts
    }),
    generationLayer(result, seen)
  ).pipe(Effect.map((outcome) => ({ outcome, seen })))
}

describe('processWorkspaceExportMessage', () => {
  it.effect('delegates a valid message to generation and acknowledges ready work', () =>
    Effect.gen(function* () {
      const seen: Array<WorkspaceExportGenerationInput> = []
      const result = yield* run(message, { _tag: 'ready', sizeBytes: 42 }, 1, seen)
      expect(result.outcome).toBe('ack')
      expect(result.seen).toEqual([
        {
          message,
          finalAttempt: false
        }
      ])
    })
  )

  it.effect('returns retry when generation says the platform should retry', () =>
    Effect.gen(function* () {
      const result = yield* run(message, { _tag: 'retry', reason: 'd1 down' })
      expect(result.outcome).toBe('retry')
    })
  )

  it.effect('acknowledges terminal skipped generation', () =>
    Effect.gen(function* () {
      const result = yield* run(message, {
        _tag: 'skipped',
        reason: 'workspace_mismatch'
      })
      expect(result.outcome).toBe('ack')
    })
  )

  it.effect('withholds the final-attempt flag while the platform still retries', () =>
    Effect.gen(function* () {
      // Cloudflare counts attempts from 1, so `maxRetries: 3` delivers a
      // message four times: attempt 3 is not the last one.
      expect(workspaceExportConsumerSettings.maxRetries).toBe(3)
      const seen: Array<WorkspaceExportGenerationInput> = []
      const result = yield* run(
        message,
        { _tag: 'retry', reason: 'unavailable: d1 down' },
        3,
        seen
      )
      expect(result.outcome).toBe('retry')
      expect(seen[0]?.finalAttempt).toBe(false)
    })
  )

  it.effect('marks the fourth delivery the final attempt for generation', () =>
    Effect.gen(function* () {
      const seen: Array<WorkspaceExportGenerationInput> = []
      const result = yield* run(
        message,
        { _tag: 'skipped', reason: 'unavailable: d1 down' },
        4,
        seen
      )
      expect(result.outcome).toBe('ack')
      expect(seen[0]?.finalAttempt).toBe(true)
    })
  )

  it.effect('acks malformed messages without invoking generation', () =>
    Effect.gen(function* () {
      const seen: Array<WorkspaceExportGenerationInput> = []
      const result = yield* run(
        { exportId: 42 },
        { _tag: 'ready', sizeBytes: 42 },
        1,
        seen
      )
      expect(result.outcome).toBe('ack')
      expect(seen).toHaveLength(0)
    })
  )
})

describe('readDelivery', () => {
  it('decodes the producer schema, traceparent included', () => {
    const delivery = readDelivery(WorkspaceExportQueueMessage, {
      id: 'qmsg_1',
      body: { ...message, traceparent: '00-abc-def-01' },
      attempts: 2
    })
    expect(delivery.kind).toBe('message')
    expect(delivery.id).toBe('qmsg_1')
    expect(delivery.attempts).toBe(2)
  })

  it('names a body that misses the workspace slug malformed', () => {
    expect(
      readDelivery(WorkspaceExportQueueMessage, {
        id: 'qmsg_2',
        body: { exportId: 'x', workspaceId: 'y' },
        attempts: 1
      })
    ).toEqual({ id: 'qmsg_2', attempts: 1, kind: 'malformed' })
  })
})

describe('retention horizon', () => {
  it('keeps the bucket lifecycle rule and the row expiry on one number', () => {
    // `infra/bindings.ts` drives the R2 lifecycle rule; the capability stamps
    // `expiresAt`. Neither imports the other, so this is where they meet — and
    // the horizon itself is pinned, so moving both declarations together still
    // fails this test.
    expect(CAPABILITY_RETENTION_DAYS).toBe(WORKSPACE_EXPORT_RETENTION_DAYS)
    expect(WORKSPACE_EXPORT_RETENTION_DAYS).toBe(7)
  })

  it('expires a ready export seven days after it completed', () => {
    // The horizon the capability stamps, against a literal date rather than a
    // second copy of its own arithmetic.
    expect(
      workspaceExportExpiresAt(DateTime.makeUnsafe('2026-09-03T08:00:00.000Z'))
    ).toBe('2026-09-10T08:00:00.000Z')
  })
})
