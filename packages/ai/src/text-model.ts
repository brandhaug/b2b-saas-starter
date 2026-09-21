import { Schema } from 'effect'
import { AiError, type LanguageModel } from 'effect/unstable/ai'

// What every adapter in this package shares: they are text-only models, and
// `plainChat` is the whole acceptance policy — no tools, no structured
// output, and a prompt of system, user and assistant messages with text parts only,
// including completed conversation history. Anything richer is refused with a
// typed `AiError` before any request is sent, instead of being silently
// flattened or ignored, so all three adapters accept exactly the same
// requests and differ in nothing but how they call their provider and encode
// its answer.

/** The one message shape these adapters send: a chat role, and text. */
export const ChatMessage = Schema.Struct({
  role: Schema.Literals(['system', 'user', 'assistant']),
  content: Schema.String
})
export type ChatMessage = typeof ChatMessage.Type

/**
 * A request these adapters can serve: its prompt as plain chat messages, or
 * the typed reason it is refused.
 */
export type PlainChat =
  | { readonly messages: ReadonlyArray<ChatMessage> }
  | { readonly reason: AiError.AiErrorReason }

/** The shared adapter prelude: one acceptance policy for every provider here. */
export function plainChat(options: LanguageModel.ProviderOptions): PlainChat {
  if (options.tools.length > 0) {
    return {
      reason: new AiError.InvalidRequestError({
        description: 'carries tools these text-only adapters cannot send'
      })
    }
  }
  if (options.responseFormat.type === 'json') {
    return {
      reason: new AiError.UnsupportedSchemaError({
        description:
          'asks for structured output these text-only adapters cannot produce'
      })
    }
  }
  const messages: Array<ChatMessage> = []
  for (const message of options.prompt.content) {
    if (
      message.role !== 'system' &&
      message.role !== 'user' &&
      message.role !== 'assistant'
    ) {
      return {
        reason: new AiError.InvalidUserInputError({
          description: `carries a '${message.role}' message; only system, user and assistant text are sent`
        })
      }
    }
    if (message.role === 'system') {
      messages.push({ role: 'system', content: message.content })
      continue
    }
    const content: Array<string> = []
    for (const part of message.content) {
      if (part.type !== 'text') {
        return {
          reason: new AiError.InvalidUserInputError({
            description: `carries a '${part.type}' part; only text is sent`
          })
        }
      }
      content.push(part.text)
    }
    messages.push({ role: message.role, content: content.join('') })
  }
  return { messages }
}
