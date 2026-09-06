import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import {
  loadWorkspaceApiTokensHandler,
  revokeApiTokenHandler
} from './api-tokens.effects'
import type * as AuthModule from './auth'

/**
 * The API-token management surface, driven through its handlers: the session
 * gate is answered by the mock with the fixture identity under test, and the
 * rest is the real path — `runWorkspaceCapabilities` resolves the inert
 * `cloudflare:workers` shim under Vitest (vite.config.ts), so `DB` is
 * undefined and the in-memory fixture answers. `usr_demo` owns the seed
 * workspace (`starter-lab`), `usr_dev` is a plain member of it.
 *
 * Real clock on purpose: plain `it`, not `it.effect`.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

describe('revokeApiTokenHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('denies a plain member — apiToken:revoke is withheld from member', async () => {
    actor.userId = 'usr_dev'
    await expect(
      revokeApiTokenHandler({ workspaceSlug: 'starter-lab', tokenId: 'tok_docs' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('revokes for an actor with apiToken:revoke', async () => {
    await expect(
      revokeApiTokenHandler({ workspaceSlug: 'starter-lab', tokenId: 'tok_docs' })
    ).resolves.toBe(true)
  })
})

describe('loadWorkspaceApiTokensHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('lists tokens with the viewer role for an owner', async () => {
    const payload = await loadWorkspaceApiTokensHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    // The seed fixtures carry two bearer credentials.
    expect(payload.tokens.length).toBeGreaterThan(0)
  })

  it('denies a plain member — reading tokens is itself gated', async () => {
    actor.userId = 'usr_dev'
    await expect(
      loadWorkspaceApiTokensHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})
