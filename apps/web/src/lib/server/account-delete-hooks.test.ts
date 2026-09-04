import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import {
  AccountLifecycle,
  type AccountDeletionPlan,
  type AccountLifecycleInterface
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import {
  makeUserDeleteHooks,
  type AccountLifecycleRunner
} from './account-delete-hooks'

import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'

/**
 * The hooks are the app half of the store's delete sequencing, so the tests
 * drive them with a stub capability that records which methods ran — the
 * capability's own behaviour is covered in
 * `@b2b-saas-starter/capabilities`; what must hold here is the hook ORDER
 * (prepare before the row goes, record after), the plan handoff between the
 * two hooks, and the best-effort contract of the after-half.
 */

function fixtureLifecycle(log: Array<string>): Layer.Layer<AccountLifecycle> {
  const implementation: AccountLifecycleInterface = {
    planDeletion: (userId) =>
      Effect.sync(() => {
        log.push(`plan:${userId}`)
        return planFor()
      }),
    prepareDeletion: (userId) =>
      Effect.sync(() => {
        log.push(`prepare:${userId}`)
        return planFor()
      }),
    recordDeleted: (input) =>
      Effect.sync(() => {
        log.push(`record:${input.userId}`)
      }),
    deleteAccount: (input) =>
      Effect.sync(() => {
        log.push(`delete:${input.userId}`)
        return planFor()
      })
  }
  return Layer.succeed(AccountLifecycle)(implementation)
}

/** The same fixture, but the audit record fails — the after-hook's best-effort half. */
function failingRecordLifecycle(log: Array<string>): Layer.Layer<AccountLifecycle> {
  const implementation: AccountLifecycleInterface = {
    planDeletion: (userId) =>
      Effect.sync(() => {
        log.push(`plan:${userId}`)
        return planFor()
      }),
    prepareDeletion: (userId) =>
      Effect.sync(() => {
        log.push(`prepare:${userId}`)
        return planFor()
      }),
    recordDeleted: () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'account-lifecycle',
          reason: 'test_store_down'
        })
      ),
    deleteAccount: (input) =>
      Effect.sync(() => {
        log.push(`delete:${input.userId}`)
        return planFor()
      })
  }
  return Layer.succeed(AccountLifecycle)(implementation)
}

function planFor(): AccountDeletionPlan {
  return {
    steps: [
      {
        workspace: { id: 'wrk_1', slug: 'lab', name: 'Lab', planId: 'team' },
        role: 'owner',
        action: 'leave'
      }
    ],
    canDelete: true
  }
}

function makeRunner(layer: Layer.Layer<AccountLifecycle>): AccountLifecycleRunner {
  return async (effect) => Effect.runPromise(Effect.provide(effect, layer))
}

describe('user delete hooks', () => {
  it('runs the teardown in beforeDelete and hands its plan to the after-hook', async () => {
    const log: Array<string> = []
    const sent: Array<{ email: string; workspacesLeft: number }> = []
    const hooks = makeUserDeleteHooks({
      runAccountLifecycle: makeRunner(fixtureLifecycle(log)),
      sendAccountDeletedEmail: async (input) => {
        sent.push(input)
      }
    })
    const request = new Request('https://starter.test/api/auth/delete-user', {
      method: 'POST'
    })
    await hooks.beforeDelete({ id: 'usr_leaver' }, request)
    expect(log).toEqual(['prepare:usr_leaver'])
    await hooks.afterDelete(
      { id: 'usr_leaver', email: 'leaver@starter.local' },
      request
    )
    expect(log).toEqual(['prepare:usr_leaver', 'record:usr_leaver'])
    // The email carries the plan's counts, not the names.
    expect(sent).toEqual([
      { email: 'leaver@starter.local', workspacesLeft: 1, workspacesDeleted: 0 }
    ])
  })

  it('records and emails nothing when no before-hook plan exists for the request', async () => {
    const log: Array<string> = []
    const sent: Array<unknown> = []
    const hooks = makeUserDeleteHooks({
      runAccountLifecycle: makeRunner(fixtureLifecycle(log)),
      sendAccountDeletedEmail: async (input) => {
        sent.push(input)
      }
    })
    await hooks.afterDelete(
      { id: 'usr_ghost', email: 'ghost@starter.local' },
      new Request('https://starter.test/api/auth/delete-user', { method: 'POST' })
    )
    expect(log).toEqual([])
    expect(sent).toEqual([])
  })

  it('propagates a failed teardown so the store aborts the delete', async () => {
    const hooks = makeUserDeleteHooks({
      runAccountLifecycle: () => Promise.reject(new Error('blocked')),
      sendAccountDeletedEmail: async () => {}
    })
    await expect(
      hooks.beforeDelete(
        { id: 'usr_blocked' },
        new Request('https://starter.test/api/auth/delete-user', { method: 'POST' })
      )
    ).rejects.toThrow('blocked')
  })

  it('a failed audit record or email never fails the after-hook', async () => {
    const log: Array<string> = []
    const hooks = makeUserDeleteHooks({
      runAccountLifecycle: makeRunner(failingRecordLifecycle(log)),
      sendAccountDeletedEmail: async () => {
        throw new Error('dispatcher down')
      }
    })
    const request = new Request('https://starter.test/api/auth/delete-user', {
      method: 'POST'
    })
    await hooks.beforeDelete({ id: 'usr_leaver' }, request)
    await expect(
      hooks.afterDelete({ id: 'usr_leaver', email: 'leaver@starter.local' }, request)
    ).resolves.toBeUndefined()
    // The prepare ran; the record was attempted and its failure swallowed.
    expect(log).toEqual(['prepare:usr_leaver'])
  })
})
