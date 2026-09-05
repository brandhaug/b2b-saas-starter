import { type AssistantProvider } from '@b2b-saas-starter/ai'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The assistant server functions and the assistant loader, in a
 * **client-safe** module.
 *
 * This file is statically imported by the assistant route, the page
 * component and its tests, and the route tree ships to the browser — so
 * everything at this module's top level rides on every page. That is why
 * the ask effect and the payload assembly (the AI service selection, the
 * permission helper, the worker env) live in `assistant.effects.ts` and are
 * reached only through dynamic `import()` inside each handler: TanStack
 * Start strips handler bodies from the client build, so the effects graph
 * never ships. The validators are stripped the same way — `.validator()`
 * runs on the server only — so the plain shape checks below are the
 * server's first decode, a wire-shape gate that declares each fn's input
 * type without dragging the Effect Schema chunk onto the route tree, while
 * the strict schemas decode again in the effects file before anything runs.
 *
 * The behaviour itself is tested as the plain effects in the effects file
 * (`assistant.test.ts` imports `assistant.effects.ts` directly).
 */

// `ASSISTANT_UNCONFIGURED_MESSAGE` moved to `lib/assistant-copy.ts`: both the
// effects half and the page need it as a value, and owning it here would make
// `assistant.effects.ts` import one from its client-safe twin (a cycle).

/**
 * The assistant page payload: who is viewing and whether a real provider is
 * configured. `assistant: ['read']` is the page's own read permission and a
 * hard gate — every role holds it today, so all members get the page; the gate
 * is what keeps the statement table as the single place that decides.
 *
 * `configured` is derived from the same env — and the same selector — the ask
 * path uses, so the UI's hidden state can never disagree with the server's
 * answer. The worker env is passed straight to `packages/ai`: its `ProviderEnv`
 * picks the assistant's keys off `ServerEnv`, so there is nothing to copy.
 */
export type AssistantPagePayload = {
  readonly viewer: WorkspaceViewer | null
  readonly configured: boolean
}

type AssistantPageInput = {
  readonly workspaceSlug: string
}

type AskAssistantInput = {
  readonly workspaceSlug: string
  readonly question: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, and the strict schemas — the question's length
 * bounds — decode again in `assistant.effects.ts`. These probes ARE the
 * I/O boundary, so `unknown` in and `throw` out is the contract, the same
 * exemption `pickOptionalStrings` carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters
function decodePageInput(input: unknown): AssistantPageInput {
  const record = expectRecord(input, 'assistant input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'assistant input') }
}

function decodeAskInput(input: unknown): AskAssistantInput {
  const record = expectRecord(input, 'assistant input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'assistant input'),
    question: expectString(record, 'question', 'assistant input')
  }
}
// oxlint-enable anti-slop/no-unknown-parameters

/** The assistant route's loader. */
export const loadAssistantPageServerFn = createServerFn({ method: 'GET' })
  .validator(decodePageInput)
  .handler(async ({ data }): Promise<AssistantPagePayload> => {
    const { loadAssistantPageHandler } = await import('./assistant.effects')
    return loadAssistantPageHandler(data)
  })

/**
 * What an ask turns into. Failures are values here rather than rejections:
 * "the provider is off" and "the provider errored" are states the chat UI
 * renders inline, not errors worth breaking the transcript over.
 */
/** The success side of {@link AskAssistantOutcome}, named for annotations. */
export type AssistantAnswered = Extract<AskAssistantOutcome, { readonly ok: true }>
/** The failure side of {@link AskAssistantOutcome}, named for annotations. */
export type AssistantRefused = Extract<AskAssistantOutcome, { readonly ok: false }>

export type AskAssistantOutcome =
  | {
      readonly ok: true
      readonly answer: string
      readonly provider: AssistantProvider
      readonly modelId: string
    }
  | {
      readonly ok: false
      readonly reason: 'unconfigured' | 'unavailable'
      readonly message: string
    }

export const askAssistantServerFn = createServerFn({ method: 'POST' })
  .validator(decodeAskInput)
  .handler(async ({ data }): Promise<AskAssistantOutcome> => {
    const { askAssistantHandler } = await import('./assistant.effects')
    return askAssistantHandler(data)
  })
