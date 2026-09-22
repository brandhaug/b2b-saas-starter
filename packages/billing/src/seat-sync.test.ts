import { expect, it } from '@effect/vitest'
import { Effect, Logger } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { withRequestScope } from '@b2b-saas-starter/logger'
import { diagnosticAnnotations } from '@b2b-saas-starter/logger/sanitization'
import { publishSeatSyncWith } from './seat-sync.ts'

it.effect(
  'retains failed seat synchronization publication on the successful request event',
  () => {
    const records: Array<ReturnType<typeof diagnosticAnnotations>> = []
    const layer = Logger.layer([
      Logger.map(Logger.formatStructured, (record) => {
        records.push(diagnosticAnnotations(record.annotations))
      })
    ])
    return Effect.gen(function* () {
      yield* withRequestScope(
        { service: 'web', event: 'member.remove' },
        publishSeatSyncWith(
          {
            publish: () =>
              Effect.fail(
                new CapabilityUnavailable({
                  capability: 'seat-sync',
                  reason: 'private-provider-diagnostic'
                })
              )
          },
          { workspaceId: 'wrk_test', reason: 'member_removed' }
        )
      )
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ status: 'ok', seatSyncPublish: 'failed' })
      expect(records[0]).not.toHaveProperty('seatSyncPublishReason')
    }).pipe(Effect.provide(layer))
  }
)
