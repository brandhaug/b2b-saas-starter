import {
  type ConversationAnswer,
  type ConversationExchange
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type ConversationHistory } from './server/assistant-conversations'

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- Browser-only WebSocket boundary probes validate the server frame without shipping Effect Schema. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(
  value: Record<string, unknown>,
  names: ReadonlyArray<string>
): boolean {
  return names.every((name) => typeof value[name] === 'string')
}
function nullableStrings(
  value: Record<string, unknown>,
  names: ReadonlyArray<string>
): boolean {
  return names.every((name) => value[name] === null || typeof value[name] === 'string')
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
/** Mirrors the persisted phase contract without importing the server schema runtime. */
function phase(value: Record<string, unknown>): boolean {
  if (value.status === 'Accepted' || value.status === 'Running') {
    return value.reason === null && value.completedAt === null
  }
  if (typeof value.completedAt !== 'string') {
    return false
  }
  const time = Date.parse(value.completedAt)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.completedAt) {
    return false
  }
  if (value.status === 'Completed') {
    return value.reason === null
  }
  return (
    (value.status === 'Interrupted' || value.status === 'Stopped') &&
    typeof value.reason === 'string' &&
    value.reason.length > 0
  )
}

function answer(value: unknown): value is ConversationAnswer {
  if (
    !record(value) ||
    !strings(value, ['id', 'questionId', 'createdAt', 'text']) ||
    !nullableStrings(value, [
      'reason',
      'completedAt',
      'provider',
      'modelId',
      'providerRequestId',
      'finishReason'
    ]) ||
    !number(value.deadline) ||
    !number(value.omittedExchanges)
  ) {
    return false
  }
  if (!phase(value)) {
    return false
  }
  if (
    ![value.inputTokens, value.outputTokens].every(
      (tokens) => tokens === null || number(tokens)
    )
  ) {
    return false
  }
  return (
    value.evidence === null ||
    (record(value.evidence) &&
      strings(value.evidence, ['taskId', 'sourceId', 'observedAt', 'text']))
  )
}
function exchange(value: unknown): value is ConversationExchange {
  return (
    record(value) &&
    record(value.question) &&
    strings(value.question, ['id', 'createdAt', 'text']) &&
    nullableStrings(value.question, ['taskId']) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(answer)
  )
}
function history(value: unknown): value is ConversationHistory {
  return (
    record(value) &&
    Array.isArray(value.items) &&
    value.items.every(exchange) &&
    nullableStrings(value, ['nextCursor']) &&
    number(value.policyRevision)
  )
}

export function readConversationSnapshot(data: string): ConversationHistory | null {
  let frame: unknown
  // oxlint-disable-next-line effect/noTryCatch -- Native browser JSON boundary; importing Effect would enter the client bundle.
  try {
    frame = JSON.parse(data)
  } catch {
    return null
  }
  if (
    !record(frame) ||
    frame.type !== 'conversation_snapshot' ||
    !history(frame.history)
  ) {
    return null
  }
  return frame.history
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
