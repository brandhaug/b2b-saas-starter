import { auditEvents, workspaces } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { type CapabilityServices } from '../layers.ts'
import {
  fakeLifecycleBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { WorkspaceLifecycle } from './workspace-lifecycle.ts'
import { workspaceLifecycleContractCases } from './workspace-lifecycle.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace lifecycle',
  (it) => {
    // The Seed half of this same list runs in index.test.ts.
    describe('live workspace lifecycle contract', () => {
      const cases = workspaceLifecycleContractCases(
        { creator: 'usr_joiner', existingSlug: 'live-lab' },
        expect
      )
      for (const contractCase of cases) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding } = fakeLifecycleBinding(db)
            yield* inWorkspace(
              'live-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              { lifecycleBinding: binding }
            )
          })
        )
      }

      it.effect(
        'deletes a workspace through the binding and audits it as a system event',
        () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding, calls } = fakeLifecycleBinding(db)
            function run<A, E>(
              slug: string,
              effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>
            ) {
              return inWorkspace(
                slug,
                effect,
                { userId: 'usr_owner' },
                { lifecycleBinding: binding }
              )
            }

            const created = yield* run(
              'live-lab',
              Effect.flatMap(WorkspaceLifecycle, (lifecycle) =>
                lifecycle.create({
                  name: 'Doomed Live',
                  slug: 'doomed-live-lab',
                  userId: 'usr_owner'
                })
              )
            )

            // The context resolves for the new owner only because the real plugin
            // makes its creator the first owner — which is what the fake mimics.
            yield* run(
              created.slug,
              WorkspaceLifecycle.pipe(Effect.flatMap((l) => l.remove))
            )

            // Called with the resolved workspace id, never a slug.
            expect(calls[1]).toEqual({ workspaceId: created.id })

            // The delete's audit row survives the cascade: attributed to no
            // workspace, naming the removed one.
            const rows = yield* Effect.flatMap(Database, (database) =>
              database
                .select()
                .from(auditEvents)
                .where(eq(auditEvents.eventType, 'workspace.deleted'))
            )
            const event = rows.find((row) => row.targetId === created.id)
            expect(event?.workspaceId).toBeNull()

            const remaining = yield* Effect.flatMap(Database, (database) =>
              database.select().from(workspaces).where(eq(workspaces.id, created.id))
            )
            expect(remaining).toHaveLength(0)
          })
      )

      it.effect('fails as unavailable when no binding is configured', () =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const lifecycle = yield* WorkspaceLifecycle
                return yield* lifecycle.create({
                  name: 'Unbound Lab',
                  slug: 'unbound-live-lab',
                  userId: 'usr_joiner'
                })
              }),
              { userId: 'usr_owner' }
            )
          )
          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error instanceof CapabilityUnavailable && error.reason).toBe(
            'no_lifecycle_binding'
          )
        })
      )
    })
  }
)
