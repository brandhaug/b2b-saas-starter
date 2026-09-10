// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import {
  MockAssistantLayer,
  type AssistantService,
  type ProviderEnv
} from '@b2b-saas-starter/ai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { type Layer } from 'effect'

import { fixtureSession } from '@/test/fixture-session'
import { m } from '@b2b-saas-starter/i18n/messages'
import { askAssistantHandler, loadAssistantPageHandler } from './assistant.effects'
import type * as AiModule from '@b2b-saas-starter/ai'
import type * as AuthModule from './auth'

/**
 * The assistant surface through its handlers. The session gate is answered
 * by the mock; everything else is the real path over the Seed layer (the
 * inert `cloudflare:workers` shim under Vitest, whose env bag carries no
 * provider keys — the honest not-enabled state is what ships). `usr_demo`
 * owns `starter-lab`, `usr_dev` is a plain member.
 *
 * The configured path stands on two env-derived decisions the worker makes
 * — "is a provider configured" and "which layer serves it" — so each is a
 * passthrough mock the configured cases re-point, with `MockAssistantLayer`
 * standing in for the layer the deployment would select (keeping the
 * network out of the test).
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

/** The deployment's two assistant decisions, mutable per test. */
type AssistantDeployment = {
  configured: boolean | null
  layer: Layer.Layer<AssistantService> | null
}

const deployment = vi.hoisted((): AssistantDeployment => ({
  configured: null,
  layer: null
}))

vi.mock('@b2b-saas-starter/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof AiModule>()
  return {
    ...actual,
    isAssistantConfigured: (provider: ProviderEnv) =>
      deployment.configured ?? actual.isAssistantConfigured(provider),
    selectAssistantLayer: (provider: ProviderEnv) =>
      deployment.layer ?? actual.selectAssistantLayer(provider)
  }
})

describe('assistant handlers', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
    deployment.configured = null
    deployment.layer = null
  })

  it('loads the page payload with configured false on an unconfigured deployment', async () => {
    const payload = await loadAssistantPageHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'owner' })
    // The shim carries no WORKERS_AI_ENABLED / OPENAI_API_KEY, so the honest
    // not-enabled state is exactly what ships.
    expect(payload.configured).toBe(false)
  })

  it('answers honestly that it is unconfigured when no provider env is set', async () => {
    const outcome = await askAssistantHandler({
      workspaceSlug: 'starter-lab',
      question: 'What changed?'
    })
    expect(outcome).toEqual({
      ok: false,
      reason: 'unconfigured',
      message: m.server_assistant_unconfigured()
    })
  })

  it('asks through AssistantService when the deployment is configured', async () => {
    deployment.configured = true
    deployment.layer = MockAssistantLayer
    const outcome = await askAssistantHandler({
      workspaceSlug: 'starter-lab',
      question: 'What changed?'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      // The mock service answered — proof the question reached the capability.
      expect(outcome.answer).toContain('What changed?')
    }
  })

  it('lets a plain member ask — every role holds assistant:read', async () => {
    deployment.configured = true
    deployment.layer = MockAssistantLayer
    actor.userId = 'usr_dev'
    const outcome = await askAssistantHandler({
      workspaceSlug: 'starter-lab',
      question: 'Hello'
    })
    expect(outcome.ok).toBe(true)
  })
})
