import { Effect, type Layer } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import {
  type AssistantReply,
  AssistantService,
  isAssistantConfigured,
  MockAssistantLayer,
  selectAssistantLayer,
  type WorkersAIBinding
} from './index.ts'

const QUESTION = 'What modules are ready?'

function ask(
  layer: Layer.Layer<AssistantService>,
  assert: (reply: AssistantReply) => void
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const reply = yield* service.ask({
        workspaceSlug: 'starter-lab',
        question: QUESTION
      })
      assert(reply)
    }).pipe(Effect.provide(layer))
  )
}

function selectsWithWorkersAI(): Promise<void> {
  const binding: WorkersAIBinding = {
    run: () => Promise.resolve({ response: 'The seeded ones.' })
  }
  return ask(
    selectAssistantLayer({ WORKERS_AI_ENABLED: 'true', AI: binding }),
    (reply) => {
      expect(reply.provider).toBe('workers-ai')
      expect(reply.modelId).toBe('@cf/meta/llama-3.1-8b-instruct')
      expect(isAssistantConfigured({ WORKERS_AI_ENABLED: 'true', AI: binding })).toBe(
        true
      )
    }
  )
}

describe('assistant provider selection', () => {
  it('answers from the mock model when nothing is configured', () =>
    ask(selectAssistantLayer({}), (reply) => {
      expect(reply.provider).toBe('mock')
      expect(reply.modelId).toBe('starter-mock')
      expect(reply.answer).toContain(QUESTION)
      expect(reply.answer).toContain('Configure WORKERS_AI_ENABLED=true')
      expect(reply.usedTools).toEqual([])
      expect(isAssistantConfigured({})).toBe(false)
    }))

  it(
    'selects workers-ai when the flag and the binding are both present',
    selectsWithWorkersAI
  )

  it('the binding alone, or the flag alone, stays unconfigured', () => {
    const binding: WorkersAIBinding = {
      run: () => Promise.resolve({ response: 'no' })
    }
    expect(isAssistantConfigured({ AI: binding })).toBe(false)
    expect(isAssistantConfigured({ WORKERS_AI_ENABLED: 'true' })).toBe(false)
  })

  it('MockAssistantLayer is the layer an unconfigured env selects', () =>
    ask(MockAssistantLayer, (reply) => {
      expect(reply.provider).toBe('mock')
    }))
})
