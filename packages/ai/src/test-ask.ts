import { Effect, Layer } from 'effect'
import { type LanguageModel, type Model } from 'effect/unstable/ai'

import {
  AssistantLive,
  type AssistantReply,
  AssistantService,
  type AssistantUnavailable
} from './index.ts'

/**
 * The shared harness for this package's tests: every ask goes through the
 * real `AssistantLive` boundary, every assertion runs inside the generator
 * (the repo's lint-clean test idiom), and every failure comes back as the
 * `AssistantUnavailable` the HTTP contract declares.
 */

/** `AssistantLive` over one model — the composition every adapter test drives. */
export function assistantOn(
  model: Layer.Layer<LanguageModel.LanguageModel | Model.ProviderName | Model.ModelName>
): Layer.Layer<AssistantService> {
  return AssistantLive.pipe(Layer.provide(model))
}

/** Runs one ask against an assistant layer, asserting on its reply. */
export function ask(
  layer: Layer.Layer<AssistantService>,
  assert: (reply: AssistantReply) => void,
  question = 'What changed?'
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const reply = yield* service.ask({ workspaceSlug: 'starter-lab', question })
      assert(reply)
    }).pipe(Effect.provide(layer))
  )
}

/** Runs one ask that must fail, asserting on the `AssistantUnavailable`. */
export function askFails(
  layer: Layer.Layer<AssistantService>,
  assert: (error: AssistantUnavailable) => void,
  question = 'What changed?'
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AssistantService
      const error = yield* Effect.flip(
        service.ask({ workspaceSlug: 'starter-lab', question })
      )
      assert(error)
    }).pipe(Effect.provide(layer))
  )
}
