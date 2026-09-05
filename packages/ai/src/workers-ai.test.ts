import { Effect } from 'effect'
import { LanguageModel, Prompt } from 'effect/unstable/ai'
import { describe, expect, it } from 'vite-plus/test'
import { ask, askFails, assistantOn } from './test-ask.ts'
import { makeWorkersAIModel, type WorkersAIBinding } from './workers-ai.ts'

describe('workers-ai model', () => {
  it('flattens the prompt into the binding and answers with its text', () => {
    const sent: Array<{ model: string; prompt: string }> = []
    const binding: WorkersAIBinding = {
      run: (model, input) => {
        sent.push({ model, prompt: input.prompt })
        return Promise.resolve({ response: 'The checklist did.' })
      }
    }
    return ask(assistantOn(makeWorkersAIModel(binding)), (reply) => {
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
  })

  it('reports a custom model id', () =>
    ask(
      assistantOn(
        makeWorkersAIModel(
          { run: () => Promise.resolve({ response: 'x' }) },
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
        )
      ),
      (reply) => {
        expect(reply.modelId).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
      }
    ))

  it('refuses a prompt carrying a message it cannot send as plain chat', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* LanguageModel.LanguageModel
        const error = yield* Effect.flip(
          model.generateText({
            prompt: Prompt.make([
              { role: 'assistant', content: [{ type: 'text', text: 'a prior turn' }] }
            ])
          })
        )
        expect(error._tag).toBe('AiError')
        expect(error.reason._tag).toBe('InvalidUserInputError')
      }).pipe(
        Effect.provide(
          makeWorkersAIModel({ run: () => Promise.resolve({ response: 'x' }) })
        )
      )
    ))

  it('fails unavailable when the binding returns no response', () =>
    askFails(
      assistantOn(makeWorkersAIModel({ run: () => Promise.resolve({}) })),
      (error) => {
        expect(error._tag).toBe('AssistantUnavailable')
        expect(error.reason).toContain('missing response text')
      }
    ))

  it('fails unavailable when the binding rejects', () =>
    askFails(
      assistantOn(
        makeWorkersAIModel({ run: () => Promise.reject(new Error('binding exploded')) })
      ),
      (error) => {
        expect(error._tag).toBe('AssistantUnavailable')
        expect(error.reason).toContain('workers-ai')
      }
    ))
})
