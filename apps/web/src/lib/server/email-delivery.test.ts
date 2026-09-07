import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import {
  loadOwnEmailDeliveryHandler,
  loadSystemEmailDeliveryHandler
} from './email-delivery.effects'
import type * as AuthModule from './auth'

const actor = vi.hoisted(() => ({ userId: 'usr_demo', systemRole: 'user' }))
vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => {
    const session = fixtureSession(actor)
    return { ...session, user: { ...session.user, role: actor.systemRole } }
  }
}))

describe('email history authorization (#285)', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
    actor.systemRole = 'user'
  })

  it('refuses global email history to a workspace owner without the System Admin role', async () => {
    await expect(loadSystemEmailDeliveryHandler()).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
  })

  it('allows a signed-in user to read their own empty provider-unconfigured history', async () => {
    expect(await loadOwnEmailDeliveryHandler()).toEqual([])
  })

  it('allows a System Admin to inspect sanitized system metadata', async () => {
    actor.systemRole = 'admin'
    expect(await loadSystemEmailDeliveryHandler()).toEqual([])
  })
})
