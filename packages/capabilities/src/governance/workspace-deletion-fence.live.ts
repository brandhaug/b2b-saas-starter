import { workspaceDeletionFences } from '@b2b-saas-starter/db/schema'
import { type EffectDatabase } from '@b2b-saas-starter/db/service'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { and, eq } from 'drizzle-orm'
import { Effect, Exit } from 'effect'
import { newCapabilityId } from '../internal/ids.ts'

/** The plugin deletes members first. Only an admitted teardown may cross the
 * last-owner guard; the storage trigger also fences concurrent checkout work. */
export function withWorkspaceDeletionFence<A, E, R>(
  db: EffectDatabase,
  workspaceId: string,
  remove: Effect.Effect<A, E, R>
) {
  const unavailable = orUnavailable('workspace-lifecycle')
  return Effect.gen(function* () {
    const token = yield* newCapabilityId('deletion')
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* unavailable(
          db
            .insert(workspaceDeletionFences)
            .values({ workspaceId, token, purpose: 'deletion' })
        )
        const result = yield* Effect.exit(restore(remove))
        yield* unavailable(
          db
            .delete(workspaceDeletionFences)
            .where(
              and(
                eq(workspaceDeletionFences.workspaceId, workspaceId),
                eq(workspaceDeletionFences.token, token)
              )
            )
        )
        if (Exit.isFailure(result)) {
          return yield* Effect.failCause(result.cause)
        }
        return result.value
      })
    )
  })
}
