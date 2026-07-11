import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, scheduledWork } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { ScheduledWorkNotFound, ScheduledWorkQueue } from './index.ts'

type Work = typeof import('./index.ts').ScheduledWork.Type

export const SeedScheduledWorkQueue = (
  records: readonly Work[] = []
): Layer.Layer<ScheduledWorkQueue> =>
  Layer.succeed(ScheduledWorkQueue)({
    findById: (workId) => {
      const work = records.find((record) => record.id === workId)
      return work
        ? Effect.succeed(work)
        : Effect.fail(new ScheduledWorkNotFound({ workId }))
    }
  })

export const LiveScheduledWorkQueue: Layer.Layer<ScheduledWorkQueue, never, Database> =
  Layer.effect(
    ScheduledWorkQueue,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findById: (workId) =>
          Effect.flatMap(
            orUnavailable('scheduled-work')(
              db
                .select()
                .from(scheduledWork)
                .where(eq(scheduledWork.id, workId))
                .limit(1)
            ),
            ([work]) =>
              work
                ? Effect.succeed({
                    id: work.id,
                    shopId: work.shopId,
                    kind: work.kind,
                    idempotencyKey: work.idempotencyKey,
                    status: work.status,
                    runAt: work.runAt,
                    attempts: work.attempts
                  })
                : Effect.fail(new ScheduledWorkNotFound({ workId }))
          )
      }
    })
  )
