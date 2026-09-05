import { describe, expect, it } from 'vite-plus/test'
import {
  isAssistantConfigured,
  MockAssistantLayer,
  selectAssistantLayer
} from './index.ts'
import { ask } from './test-ask.ts'
import { type WorkersAIBinding } from './workers-ai.ts'

const QUESTION = 'What modules are ready?'

describe('assistant provider selection', () => {
  it('answers from the mock model when nothing is configured', () =>
    ask(
      selectAssistantLayer({}),
      (reply) => {
        expect(reply.provider).toBe('mock')
        expect(reply.modelId).toBe('starter-mock')
        expect(reply.answer).toContain(QUESTION)
        expect(reply.answer).toContain('Configure WORKERS_AI_ENABLED=true')
        expect(reply.usedTools).toEqual([])
        expect(isAssistantConfigured({})).toBe(false)
      },
      QUESTION
    ))

  it('selects workers-ai when the flag and the binding are both present', () => {
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
  })

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
