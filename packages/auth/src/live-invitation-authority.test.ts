import { workspaceInvitations } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { Auth } from './index.ts'
import { buildAuthLayer, provisionAuthD1, signUpSession } from './test-auth-layer.ts'

it.live(
  'the organization plugin refuses an admin granting owner by invitation',
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => provisionAuthD1()),
        (db) => Effect.promise(() => db.dispose())
      )
      yield* Effect.gen(function* () {
        const owner = yield* signUpSession('owner@invitation-authority.test')
        const admin = yield* signUpSession('admin@invitation-authority.test')
        const auth = yield* Auth.Tag
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Invitation authority', slug: 'invitation-authority' },
          headers: owner.headers
        })
        yield* auth.api.addMember({
          body: {
            organizationId: workspace.id,
            userId: admin.userId,
            role: 'admin'
          }
        })
        const input = {
          organizationId: workspace.id,
          email: 'recipient@invitation-authority.test',
          role: 'owner'
        } satisfies { organizationId: string; email: string; role: 'owner' }
        const refused = yield* Effect.result(
          auth.api.createInvitation({
            body: input,
            headers: admin.headers
          })
        )
        expect(Result.isFailure(refused)).toBe(true)
        expect(
          yield* Effect.promise(() =>
            fixture.db
              .select()
              .from(workspaceInvitations)
              .where(eq(workspaceInvitations.workspaceId, workspace.id))
          )
        ).toEqual([])
        const allowed = yield* auth.api.createInvitation({
          body: input,
          headers: owner.headers
        })
        expect(allowed.role).toBe('owner')
      }).pipe(Effect.provide(buildAuthLayer(fixture.db)))
    }).pipe(Effect.scoped),
  60_000
)
