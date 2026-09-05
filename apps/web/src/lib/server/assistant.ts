import { type AssistantProvider } from '@b2b-saas-starter/ai'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The assistant server functions and the assistant loader, in a
 * **client-safe** module: the client-safe half of the `assistant.effects.ts`
 * split (see apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs`
 * for the enforcement). Each input is written once, as its Effect Schema —
 * the validator is the single strict decode, and the derived types below
 * type both the client stub and the effects handlers.
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

const AssistantPageInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

// All input constraints live in the schema — mirrors AssistantPrompt in
// `packages/ai` so the UI cannot send what the capability would refuse.
const AskAssistantInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000))
})

export type AssistantPageInput = typeof AssistantPageInput.Type
export type AskAssistantInput = typeof AskAssistantInput.Type

/** The assistant route's loader. */
export const loadAssistantPageServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(AssistantPageInput))
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
  .validator(Schema.decodeUnknownSync(AskAssistantInput))
  .handler(async ({ data }): Promise<AskAssistantOutcome> => {
    const { askAssistantHandler } = await import('./assistant.effects')
    return askAssistantHandler(data)
  })
