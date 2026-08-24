import { Effect } from 'effect'
import { MockAssistantLayer, type ProviderEnv } from '@b2b-saas-starter/ai'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_UNCONFIGURED_MESSAGE,
  askAssistantEffect,
  loadAssistantPage
} from './assistant'
import { runWorkspaceCapabilities } from '../capabilities'

/**
 * The loader and the ask effect, driven against the Seed layer: under Vitest
 * `cloudflare:workers` resolves to the inert shim, so `DB` is undefined and
 * the in-memory fixture answers. `usr_demo` owns the seed workspace
 * (`starter-lab`) — which is what makes a member-level assertion possible.
 *
 * The provider env is an explicit argument to `askAssistantEffect`, so tests
 * pin it instead of reading the shim's env; `MockAssistantLayer` stands in for
 * whatever layer `selectAssistantLayer` would pick in production, keeping the
 * network out of the test.
 */
const OWNER = 'usr_demo'
const MEMBER = 'usr_dev'

function ask(question: string, provider: ProviderEnv, userId = OWNER) {
  return runWorkspaceCapabilities(
    'starter-lab',
    askAssistantEffect(question, provider).pipe(Effect.provide(MockAssistantLayer)),
    { userId }
  )
}

describe('assistant', () => {
  it('loads the page payload with configured false on an unconfigured deployment', async () => {
    const payload = await loadAssistantPage({
      workspaceSlug: 'starter-lab',
      userId: OWNER
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    // The shim carries no WORKERS_AI_ENABLED / OPENAI_API_KEY, so the honest
    // not-enabled state is exactly what ships.
    expect(payload.configured).toBe(false)
  })

  it('answers honestly that it is unconfigured when no provider env is set', async () => {
    const outcome = await ask('What changed?', {})
    expect(outcome).toEqual({
      ok: false,
      reason: 'unconfigured',
      message: ASSISTANT_UNCONFIGURED_MESSAGE
    })
  })

  it('asks through AssistantService when the deployment is configured', async () => {
    const outcome = await ask('What changed?', { OPENAI_API_KEY: 'test-key' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      // The mock service answered — proof the question reached the capability.
      expect(outcome.answer).toContain('What changed?')
    }
  })

  it('lets a plain member ask — every role holds assistant:read', async () => {
    const outcome = await ask('Hello', { OPENAI_API_KEY: 'test-key' }, MEMBER)
    expect(outcome.ok).toBe(true)
  })
})
