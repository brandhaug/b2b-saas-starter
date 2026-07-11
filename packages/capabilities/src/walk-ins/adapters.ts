import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, walkInEntries } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { WalkInEntryNotFound, WalkIns } from './index.ts'

type Entry = typeof import('./index.ts').WalkInEntry.Type
export const SeedWalkIns = (records: readonly Entry[] = []): Layer.Layer<WalkIns> =>
  Layer.succeed(WalkIns)({
    findById: (entryId) => {
      const entry = records.find((record) => record.id === entryId)
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(new WalkInEntryNotFound({ entryId }))
    }
  })
export const LiveWalkIns: Layer.Layer<WalkIns, never, Database> = Layer.effect(
  WalkIns,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      findById: (entryId) =>
        Effect.flatMap(
          orUnavailable('walk-ins')(
            db
              .select()
              .from(walkInEntries)
              .where(eq(walkInEntries.id, entryId))
              .limit(1)
          ),
          ([entry]) =>
            entry
              ? Effect.succeed({
                  id: entry.id,
                  shopId: entry.shopId,
                  status: entry.status,
                  position: entry.position
                })
              : Effect.fail(new WalkInEntryNotFound({ entryId }))
        )
    }
  })
)
