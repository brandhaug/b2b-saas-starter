import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { AssistantService, MockAssistantLayer, selectAssistantLayer } from './index.ts'

describe('AssistantService', () => {
  it('mock layer answers deterministically', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* AssistantService
        const reply = yield* service.ask({
          workspaceSlug: 'starter-lab',
          question: 'What modules are ready?'
        })
        expect(reply.provider).toBe('mock')
        expect(reply.answer).toContain('starter-lab')
      }).pipe(Effect.provide(MockAssistantLayer))
    ))

  it('selects mock when nothing is configured', () => {
    expect(selectAssistantLayer({})).toBe(MockAssistantLayer)
  })
})
