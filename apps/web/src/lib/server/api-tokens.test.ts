import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import {
  loadWorkspaceApiTokensHandler,
  replaceApiTokenHandler,
  createApiTokenHandler,
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

describe('token lifecycle handlers', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('passes optional expiry through creation', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z'
    const token = await createApiTokenHandler({
      workspaceSlug: 'starter-lab',
      name: 'Expiring',
      scopes: ['read'],
      expiresAt
    })
    expect(token.expiresAt).toBe(expiresAt)
  })

  it('requires mint permission for replacements', async () => {
    actor.userId = 'usr_dev'
    await expect(
      replaceApiTokenHandler({
        workspaceSlug: 'starter-lab',
        tokenId: 'tok_docs',
        scopes: ['read'],
        overlapSeconds: 0
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('replaces a token for an owner in the authorized workspace', async () => {
    const replacement = await replaceApiTokenHandler({
      workspaceSlug: 'starter-lab',
      tokenId: 'tok_docs',
      scopes: ['read'],
      overlapSeconds: 0
    })
    expect(replacement.previousTokenId).toBe('tok_docs')
    expect(replacement.token).toMatch(/^bsk_/)
  })
})
