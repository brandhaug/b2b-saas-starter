import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { AssistantService, MockAssistantLayer, selectAssistantLayer } from './index.ts'

describe('AssistantService', () => {
  it.effect('mock layer answers deterministically', () =>
    Effect.gen(function* () {
      const service = yield* AssistantService
      const reply = yield* service.ask({
        workspaceSlug: 'starter-lab',
        question: 'What modules are ready?'
      })
      expect(reply.provider).toBe('mock')
      expect(reply.answer).toContain('starter-lab')
    }).pipe(Effect.provide(MockAssistantLayer))
  )

  it('selects mock when nothing is configured', () => {
    expect(selectAssistantLayer({})).toBe(MockAssistantLayer)
  })
})
