import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import {
  type AssistantReply,
  AssistantService,
  type AssistantUnavailable,
  AssistantLive,
  makeWorkersAIModel,
  type WorkersAIBinding
} from './index.ts'

function ask(
  binding: WorkersAIBinding,
  modelId?: string,
  assert: (reply: AssistantReply) => void = () => {}
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const reply = yield* service.ask({
        workspaceSlug: 'starter-lab',
        question: 'What changed?'
      })
      assert(reply)
    }).pipe(
      Effect.provide(AssistantLive),
      Effect.provide(makeWorkersAIModel(binding, modelId))
    )
  )
}

function flipsToUnavailable(
  binding: WorkersAIBinding,
  assert: (error: AssistantUnavailable) => void
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const error = yield* Effect.flip(
        service.ask({ workspaceSlug: 'starter-lab', question: 'What changed?' })
      )
      assert(error)
    }).pipe(Effect.provide(AssistantLive), Effect.provide(makeWorkersAIModel(binding)))
  )
}

function flattensThePrompt(): Promise<void> {
  const sent: Array<{ model: string; prompt: string }> = []
  const binding: WorkersAIBinding = {
    run: (model, input) => {
      sent.push({ model, prompt: input.prompt })
      return Promise.resolve({ response: 'The checklist did.' })
    }
  }
  return ask(binding, undefined, (reply) => {
    expect(reply.answer).toBe('The checklist did.')
    expect(reply.provider).toBe('workers-ai')
    expect(reply.modelId).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect(reply.usedTools).toEqual([])
    // The normalized prompt carries both halves: the system message names the
    // workspace, the user message carries the question.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.model).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect(sent[0]?.prompt).toContain('starter-lab')
    expect(sent[0]?.prompt).toContain('What changed?')
  })
}

describe('workers-ai model', () => {
  it(
    'flattens the prompt into the binding and answers with its text',
    flattensThePrompt
  )

  it('reports a custom model id', () =>
    ask(
      { run: () => Promise.resolve({ response: 'x' }) },
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      (reply) => {
        expect(reply.modelId).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
      }
    ))

  it('fails unavailable when the binding returns no response', () =>
    flipsToUnavailable({ run: () => Promise.resolve({}) }, (error) => {
      expect(error._tag).toBe('AssistantUnavailable')
      expect(error.reason).toContain('missing response text')
    }))

  it('fails unavailable when the binding rejects', () =>
    flipsToUnavailable(
      { run: () => Promise.reject(new Error('binding exploded')) },
      (error) => {
        expect(error._tag).toBe('AssistantUnavailable')
        expect(error.reason).toContain('workers-ai')
      }
    ))
})
