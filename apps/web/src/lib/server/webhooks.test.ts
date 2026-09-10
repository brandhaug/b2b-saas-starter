// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureAuthModule } from '@/test/fixture-session'
import {
  loadWorkspaceWebhooksHandler,
  listWebhookDeliveryAttemptsHandler,
  replayWebhookDeliveryHandler,
  rotateWebhookSecretHandler,
  sendTestEventHandler,
  updateWebhookEndpointHandler
} from './webhooks.effects'
import type * as AuthModule from './auth'

/**
 * The webhook management surface, driven through its handlers: the session
 * gate is answered by the mock with the fixture identity under test, and the
 * rest is the real path — `runWorkspaceCapabilities` resolves the inert
 * `cloudflare:workers` shim under Vitest (vite.config.ts), so `DB` is
 * undefined and the in-memory fixture answers. The seed workspace carries
 * `wh_release` (enabled, with the failed delivery `whd_seed_failed`) and
 * `wh_billing` (disabled) — the states the verbs below branch on. `usr_demo`
 * owns `starter-lab`, `usr_ops` is its admin, `usr_dev` a plain member.
 * Each call builds its own Seed layer, so every case asserts its own call's
 * outcome. Real clock on purpose: plain `it`, not `it.effect`.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)

const OWNER = 'usr_demo'
const ADMIN = 'usr_ops'
const MEMBER = 'usr_dev'

describe('loadWorkspaceWebhooksHandler', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('lists endpoints with deliveries attached for an owner', async () => {
    const payload = await loadWorkspaceWebhooksHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    expect(payload.endpoints.length).toBeGreaterThan(0)
    // Every endpoint carries its delivery list, even when empty.
    for (const endpoint of payload.endpoints) {
      expect(Array.isArray(endpoint.deliveries)).toBe(true)
    }
  })

  it('denies a plain member — reading webhooks is itself gated', async () => {
    actor.userId = MEMBER
    await expect(
      loadWorkspaceWebhooksHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})

describe('updateWebhookEndpointHandler', () => {
  beforeEach(() => {
    actor.userId = ADMIN
  })

  it('denies a plain member — webhook:update is withheld from member', async () => {
    actor.userId = MEMBER
    await expect(
      updateWebhookEndpointHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_release',
        enabled: false
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('fails the typed 404 for an unknown endpoint', async () => {
    await expect(
      updateWebhookEndpointHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_missing',
        enabled: false
      })
    ).rejects.toMatchObject({ _tag: 'WebhookEndpointNotFound' })
  })
})

describe('rotateWebhookSecretHandler', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('returns the new secret to an actor with webhook:rotateSecret', async () => {
    await expect(
      rotateWebhookSecretHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_release'
      })
    ).resolves.toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
  })

  it('denies a plain member — webhook:rotateSecret is withheld from member', async () => {
    actor.userId = MEMBER
    await expect(
      rotateWebhookSecretHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_release'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('fails the typed 404 for an unknown endpoint — none is minted', async () => {
    await expect(
      rotateWebhookSecretHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_missing'
      })
    ).rejects.toMatchObject({ _tag: 'WebhookEndpointNotFound' })
  })
})

describe('replayWebhookDeliveryHandler', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('requeues the failed seed delivery for webhook:replay', async () => {
    const replayed = await replayWebhookDeliveryHandler({
      workspaceSlug: 'starter-lab',
      deliveryId: 'whd_seed_failed'
    })
    // The copy is a new row linked to its source (the capability's own
    // contract asserts the linkage and the reset attempts).
    expect(replayed.deliveryId).not.toBe('whd_seed_failed')
  })

  it('fails the typed 404 for an unknown delivery', async () => {
    await expect(
      replayWebhookDeliveryHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_missing'
      })
    ).rejects.toMatchObject({ _tag: 'WebhookDeliveryNotFound' })
  })

  it('denies a plain member — webhook:replay is withheld from member', async () => {
    actor.userId = MEMBER
    await expect(
      replayWebhookDeliveryHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_seed_failed'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})

describe('sendTestEventHandler', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('queues a pending webhook.test_event for webhook:test', async () => {
    const sent = await sendTestEventHandler({
      workspaceSlug: 'starter-lab',
      endpointId: 'wh_release'
    })
    expect(sent.deliveryId).toMatch(/^whd_/)
  })

  it('refuses a disabled endpoint', async () => {
    await expect(
      sendTestEventHandler({ workspaceSlug: 'starter-lab', endpointId: 'wh_billing' })
    ).rejects.toMatchObject({ _tag: 'WebhookDispatchRejected' })
  })

  it('denies a plain member — webhook:test is withheld from member', async () => {
    actor.userId = MEMBER
    await expect(
      sendTestEventHandler({
        workspaceSlug: 'starter-lab',
        endpointId: 'wh_release'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})

describe('updateWebhookEndpointHandler — the mutating case', () => {
  it('lets an actor with webhook:update disable', async () => {
    actor.userId = ADMIN
    const endpoint = await updateWebhookEndpointHandler({
      workspaceSlug: 'starter-lab',
      endpointId: 'wh_release',
      enabled: false
    })
    expect(endpoint).toMatchObject({ id: 'wh_release', enabled: false })
  })
})

describe('listWebhookDeliveryAttemptsHandler', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('reads retained evidence for a workspace delivery', async () => {
    const attempts = await listWebhookDeliveryAttemptsHandler({
      workspaceSlug: 'starter-lab',
      deliveryId: 'whd_seed_failed'
    })
    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.every((attempt) => attempt.deliveryId === 'whd_seed_failed')).toBe(
      true
    )
  })

  it('does not reveal evidence to a member without webhook:list', async () => {
    actor.userId = MEMBER
    await expect(
      listWebhookDeliveryAttemptsHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_seed_failed'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('returns no evidence for an unknown delivery', async () => {
    await expect(
      listWebhookDeliveryAttemptsHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_foreign'
      })
    ).resolves.toEqual([])
  })
})
