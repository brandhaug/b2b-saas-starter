import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { WorkspaceInvitations } from './governance/workspace-invitations.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import { selectCapabilitiesLayer, selectWorkspaceLayer } from './runtime.ts'
import {
  fakeInvitationBinding,
  LIVE_SUITE_TIMEOUT,
  TestD1,
  TestDatabase
} from './testing/live-harness.ts'

// Decision 25: an app hands its plugin bindings to these selectors per call,
// not on a module-level env, because `apps/web/src/lib/capabilities.ts` is
// bundled for the browser as well as the worker. Every other live suite is
// handed a layer already built — these two exercise the selection an app
// actually makes, and so are the only cases that prove a binding put on
// `StarterEnv` reaches the capability at all.
layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live layer selection from StarterEnv',
  (it) => {
    describe('live layer selection from StarterEnv', () => {
      it.effect('carries the invitation binding into the workspace layer', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const d1 = yield* TestD1
          const { binding, calls } = fakeInvitationBinding(db)

          const created = yield* Effect.provide(
            Effect.flatMap(WorkspaceInvitations, (invitations) =>
              invitations.create({
                email: 'selected@live-invite.test',
                role: 'member'
              })
            ),
            selectWorkspaceLayer({ DB: d1, invitationBinding: binding }, 'live-lab', {
              userId: 'usr_owner'
            })
          )

          expect(created.email).toBe('selected@live-invite.test')
          // The workspace id comes from the slug the selector resolved, so this
          // also proves the live `WorkspaceContext` was the one selected.
          expect(calls).toEqual([
            {
              workspaceId: 'wrk_live',
              email: 'selected@live-invite.test',
              role: 'member'
            }
          ])
        })
      )

      it.effect('selects the live layer for an identity-keyed read', () =>
        Effect.gen(function* () {
          const d1 = yield* TestD1
          const memberships = yield* Effect.provide(
            Effect.flatMap(WorkspaceMembership, (membership) =>
              membership.listWorkspacesForUser('usr_owner')
            ),
            selectCapabilitiesLayer({ DB: d1 })
          )

          // `live-lab` exists only in D1. Had the selector fallen to the Seed
          // branch this would be empty, because no fixture member is `usr_owner`.
          expect(memberships.map((each) => each.workspace.slug)).toContain('live-lab')
        })
      )
    })
  }
)
