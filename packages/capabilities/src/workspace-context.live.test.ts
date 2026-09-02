import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from './testing/live-harness.ts'
import { WorkspaceContext } from './workspace-context.ts'

// Live-layer coverage against a real local D1 (all migrations applied). The
// Seed-layer tests in index.test.ts validate contracts; these validate that
// the D1 adapters — queries, batches, workspace scoping — behave the same.

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live workspace context', (it) => {
  describe('live workspace context', () => {
    it.effect('resolves the workspace and actor for a member', () =>
      Effect.gen(function* () {
        const ctx = yield* inWorkspace('live-lab', WorkspaceContext, {
          userId: 'usr_owner'
        })
        expect(ctx.workspace.id).toBe('wrk_live')
        expect(ctx.actor?.role).toBe('owner')
      })
    )

    it.effect('fails with WorkspaceNotFound for an unknown slug', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('no-such-workspace', WorkspaceContext)
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )

    it.effect('fails identically for a non-member actor (non-disclosing)', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('live-lab', WorkspaceContext, { userId: 'usr_outsider' })
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )
  })
})
