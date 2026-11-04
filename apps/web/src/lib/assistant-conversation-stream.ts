import {
  ConversationPage,
  type ConversationExchange
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type ConversationHistory } from './server/assistant-conversations'
import { Option, Schema } from 'effect'

const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json).pipe(
    Schema.decodeTo(
      Schema.Struct({
        type: Schema.Literal('conversation_snapshot'),
        history: ConversationPage
      })
    )
  )
)

export function readConversationSnapshot(data: string): ConversationHistory | null {
  return Option.getOrNull(Option.map(decodeSnapshot(data), (frame) => frame.history))
}

function compareExchanges(left: ConversationExchange, right: ConversationExchange) {
  return (
    left.question.createdAt.localeCompare(right.question.createdAt) ||
    left.question.id.localeCompare(right.question.id)
  )
}

/** Overlapping snapshots retain loaded pages; a catch-up gap restarts pagination. */
export function mergeConversationHistory(
  current: ConversationHistory | null,
  incoming: ConversationHistory,
  source: 'snapshot' | 'page'
): ConversationHistory {
  if (current === null) {
    return incoming
  }
  if (incoming.policyRevision < current.policyRevision) {
    return current
  }
  const exchanges = new Map(current.items.map((item) => [item.question.id, item]))
  if (
    source === 'snapshot' &&
    !incoming.items.some((item) => exchanges.has(item.question.id))
  ) {
    const latestIncoming = incoming.items.at(-1)
    const latestCurrent = current.items.at(-1)
    // The newest page owns the cursor across a reconnect gap. Ignore delayed reads.
    return latestIncoming &&
      (!latestCurrent || compareExchanges(latestIncoming, latestCurrent) > 0)
      ? incoming
      : current
  }
  for (const item of incoming.items) {
    const previous = exchanges.get(item.question.id)
    if (source === 'page' && previous !== undefined) {
      continue
    }
    const attempts = item.attempts.map((attempt) => {
      const existing = previous?.attempts.find((value) => value.id === attempt.id)
      if (
        !existing ||
        (attempt.status !== 'Accepted' && attempt.status !== 'Running')
      ) {
        return attempt
      }
      if (existing.status !== 'Accepted' && existing.status !== 'Running') {
        return existing
      }
      return existing.text.length > attempt.text.length ? existing : attempt
    })
    exchanges.set(item.question.id, { question: item.question, attempts })
  }
  return {
    items: [...exchanges.values()].toSorted(compareExchanges),
    policyRevision: incoming.policyRevision,
    nextCursor: source === 'page' ? incoming.nextCursor : current.nextCursor
  }
}
