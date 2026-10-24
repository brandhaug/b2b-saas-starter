import { Effect, Exit, Layer } from 'effect'
import { expect, it } from '@effect/vitest'
import { eq } from 'drizzle-orm'
import {
  workspaceMembers,
  workspaces,
  workspaceDeletionFences
} from '@b2b-saas-starter/db/schema'
import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { makeLiveCapabilitiesLayer } from '../layers.ts'
import { WorkspaceLifecycle } from './workspace-lifecycle.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { Auth } from '../../../auth/src/index.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession
} from '../../../auth/src/test-auth-layer.ts'

// Real plugin requests, real migrated workerd D1. Each pair starts before either
// finishes; membership reads cannot serve as the final owner invariant.
for (const operation of ['demote', 'remove', 'leave']) {
  it.live(
    `retains an owner across concurrent plugin ${operation} requests`,
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => provisionAuthD1()),
        (fixture) =>
          Effect.gen(function* () {
            const a = yield* signUpSession(`owner-a-${operation}@race.test`)
            const b = yield* signUpSession(`owner-b-${operation}@race.test`)
            const auth = yield* Auth.Tag
            const workspace = yield* auth.api.createOrganization({
              body: { name: 'Owner race', slug: `race-${operation}` },
              headers: a.headers
            })
            yield* auth.api.addMember({
              body: { userId: b.userId, organizationId: workspace.id, role: 'owner' }
            })
            const members = yield* Effect.promise(() =>
              fixture.db
                .select()
                .from(workspaceMembers)
                .where(eq(workspaceMembers.workspaceId, workspace.id))
            )
            const memberA = members.find((member) => member.userId === a.userId)
            const memberB = members.find((member) => member.userId === b.userId)
            if (!memberA || !memberB) {
              throw new Error('fixture members missing')
            }
            function change(actor: typeof a, target: (typeof members)[number]) {
              if (operation === 'demote') {
                return auth.api
                  .updateMemberRole({
                    headers: actor.headers,
                    body: {
                      organizationId: workspace.id,
                      memberId: target.id,
                      role: 'member'
                    }
                  })
                  .pipe(Effect.asVoid)
              }
              if (operation === 'remove') {
                return auth.api
                  .removeMember({
                    headers: actor.headers,
                    body: { organizationId: workspace.id, memberIdOrEmail: target.id }
                  })
                  .pipe(Effect.asVoid)
              }
              return auth.api
                .leaveOrganization({
                  headers: actor.headers,
                  body: { organizationId: workspace.id }
                })
                .pipe(Effect.asVoid)
            }
            const results = yield* Effect.all(
              [
                change(a, memberB).pipe(Effect.exit),
                change(b, memberA).pipe(Effect.exit)
              ],
              { concurrency: 'unbounded' }
            )
            const remaining = yield* Effect.promise(() =>
              fixture.db
                .select()
                .from(workspaceMembers)
                .where(eq(workspaceMembers.workspaceId, workspace.id))
            )
            expect(remaining.filter((member) => member.role === 'owner')).toHaveLength(
              1
            )
            expect(results.filter(Exit.isFailure)).toHaveLength(1)
          }).pipe(Effect.provide(buildAuthLayer(fixture.db))),
        (fixture) => Effect.promise(() => fixture.dispose())
      ),
    60_000
  )
}

it.live(
  'deletes a sole-owner workspace through the real plugin with its capability fence',
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() => provisionAuthD1()),
      (fixture) =>
        Effect.gen(function* () {
          const owner = yield* signUpSession('solo-delete@race.test')
          const auth = yield* Auth.Tag
          const workspace = yield* auth.api.createOrganization({
            body: { name: 'Solo', slug: 'solo-delete' },
            headers: owner.headers
          })
          const binding = {
            create: (input: { name: string; slug: string; userId: string }) =>
              auth.instance.api
                .createOrganization({ body: input })
                .then(() => undefined),
            rename: (input: { workspaceId: string; name: string }) =>
              auth.instance.api
                .updateOrganization({
                  headers: owner.headers,
                  body: {
                    organizationId: input.workspaceId,
                    data: { name: input.name }
                  }
                })
                .then(() => undefined),
            remove: (input: { workspaceId: string }) =>
              auth.instance.api
                .deleteOrganization({
                  headers: owner.headers,
                  body: { organizationId: input.workspaceId }
                })
                .then(() => undefined)
          }
          yield* Effect.flatMap(
            WorkspaceLifecycle,
            (lifecycle) => lifecycle.remove
          ).pipe(
            Effect.provideService(WorkspaceContext, {
              workspace: {
                id: workspace.id,
                name: workspace.name,
                slug: workspace.slug,
                planId: 'starter'
              },
              actor: {
                userId: owner.userId,
                role: 'owner',
                systemRole: 'user',
                banned: false
              },
              actorType: 'user'
            }),
            Effect.provide(
              makeLiveCapabilitiesLayer({ lifecycleBinding: binding }).pipe(
                Layer.provide(layerFromD1(fixture.d1))
              )
            )
          )
          expect(
            yield* Effect.promise(() =>
              fixture.db
                .select()
                .from(workspaces)
                .where(eq(workspaces.id, workspace.id))
            )
          ).toHaveLength(0)
          expect(
            yield* Effect.promise(() =>
              fixture.db.select().from(workspaceDeletionFences)
            )
          ).toHaveLength(0)
        }).pipe(Effect.provide(buildAuthLayer(fixture.db))),
      (fixture) => Effect.promise(() => fixture.dispose())
    ),
  60_000
)
