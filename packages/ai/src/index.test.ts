import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { AssistantService, MockAssistantLayer, selectAssistantLayer } from './index.ts'

describe('AssistantService', () => {
  it('mock layer answers deterministically', async () => {
    const program = Effect.gen(function* () {
      const service = yield* AssistantService
      return yield* service.ask({
        workspaceSlug: 'starter-lab',
        question: 'What modules are ready?'
      })
    })
    const reply = await Effect.runPromise(
      program.pipe(Effect.provide(MockAssistantLayer))
    )
    expect(reply.provider).toBe('mock')
    expect(reply.answer).toContain('starter-lab')
  })

  it('selects mock when nothing is configured', () => {
    expect(selectAssistantLayer({})).toBe(MockAssistantLayer)
  })
})
