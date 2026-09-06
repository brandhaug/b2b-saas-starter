import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import {
  loadFailedDeliveriesHandler,
  replayFailedDeliveryHandler
} from './admin.effects'
import { replayWebhookDeliveryHandler } from './webhooks.effects'
import type * as AuthModule from './auth'
import * as capabilities from '../capabilities'
import { webRuntime } from '../observability'

type AdminTestActor = {
  userId: string
  role: string
  impersonatedBy: string | null
  signedIn: boolean
}
const actor = vi.hoisted((): AdminTestActor => ({
  userId: 'usr_global_admin',
  role: 'admin',
  impersonatedBy: null,
  signedIn: true
}))

vi.mock('./auth', async (importOriginal) => {
  const original = await importOriginal<typeof AuthModule>()
  return {
    ...original,
    requireRequestSession: async () => {
      if (!actor.signedIn) {
        throw new original.UnauthorizedError()
      }
      const session = fixtureSession(actor)
      return { ...session, user: { ...session.user, role: actor.role } }
    }
  }
})

describe('admin failed deliveries boundary', () => {
  beforeEach(() => {
    actor.userId = 'usr_global_admin'
    actor.role = 'admin'
    actor.impersonatedBy = null
    actor.signedIn = true
  })

  it('lets a system admin with no workspace membership read and replay globally', async () => {
    const page = await loadFailedDeliveriesHandler({})
    expect(page.items.map((row) => row.status)).toEqual([
      'dead_lettered',
      'failed_permanent'
    ])
    expect(
      await replayFailedDeliveryHandler({ deliveryId: 'whd_seed_dead_lettered' })
    ).toMatchObject({ status: 'queued' })
    // The same identity still has no workspace membership.
    await expect(
      replayWebhookDeliveryHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_seed_dead_lettered'
      })
    ).rejects.toMatchObject({ isNotFound: true })
  })

  it.each(['user', 'owner'])(
    'denies direct calls by a non-system-admin with role %s',
    async (role) => {
      actor.role = role
      const reads = vi.spyOn(capabilities, 'runCapabilities')
      const effects = vi.spyOn(webRuntime, 'runPromise')
      reads.mockClear()
      effects.mockClear()
      await expect(loadFailedDeliveriesHandler({})).rejects.toMatchObject({
        name: 'UnauthorizedError'
      })
      await expect(
        replayFailedDeliveryHandler({ deliveryId: 'whd_seed_dead_lettered' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' })
      expect(reads).not.toHaveBeenCalled()
      expect(effects).not.toHaveBeenCalled()
      reads.mockRestore()
      effects.mockRestore()
    }
  )

  it('fails closed without a session', async () => {
    actor.signedIn = false
    await expect(loadFailedDeliveriesHandler({})).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
    await expect(
      replayFailedDeliveryHandler({ deliveryId: 'whd_seed_dead_lettered' })
    ).rejects.toMatchObject({ name: 'UnauthorizedError' })
  })

  it('refuses replay while impersonating even if the effective account is admin', async () => {
    actor.impersonatedBy = 'usr_other_admin'
    await expect(
      replayFailedDeliveryHandler({ deliveryId: 'whd_seed_dead_lettered' })
    ).rejects.toMatchObject({ name: 'ImpersonationStateError' })
  })

  it('returns safe inline guidance for disabled, missing and nonterminal sources', async () => {
    expect(
      await replayFailedDeliveryHandler({ deliveryId: 'whd_seed_perm_failed' })
    ).toMatchObject({
      status: 'refused',
      reason: expect.stringContaining('could not be replayed')
    })
    expect(await replayFailedDeliveryHandler({ deliveryId: 'missing' })).toMatchObject({
      status: 'refused',
      reason: expect.stringContaining('could not be replayed')
    })
    expect(
      await replayFailedDeliveryHandler({ deliveryId: 'whd_seed_failed' })
    ).toMatchObject({
      status: 'refused',
      reason: expect.stringContaining('could not be replayed')
    })
  })
})
