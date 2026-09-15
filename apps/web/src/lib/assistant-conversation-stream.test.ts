import { describe, expect, it } from 'vite-plus/test'
import { type ConversationHistory } from './server/assistant-conversations'
import {
  mergeConversationHistory,
  readConversationSnapshot
} from './assistant-conversation-stream'

function page(
  status: 'Running' | 'Completed' | 'Interrupted' = 'Running',
  text = 'Saved answer'
): ConversationHistory {
  return {
    policyRevision: 1,
    nextCursor: 'older',
    items: [
      {
        question: {
          id: 'q1',
          createdAt: '2026-09-15T10:00:00Z',
          text: 'Question',
          taskId: null
        },
        attempts: [
          {
            id: 'a1',
            questionId: 'q1',
            createdAt: '2026-09-15T10:00:00Z',
            status,
            text,
            deadline: 100,
            reason: null,
            completedAt: null,
            provider: null,
            modelId: null,
            providerRequestId: null,
            finishReason: null,
            inputTokens: null,
            outputTokens: null,
            omittedExchanges: 0,
            evidence: null
          }
        ]
      }
    ]
  }
}
describe('conversation observer frames', () => {
  it('accepts complete snapshots and rejects malformed frames', () => {
    const history = page()
    expect(
      readConversationSnapshot(
        JSON.stringify({ type: 'conversation_snapshot', history })
      )
    ).toEqual(history)
    expect(readConversationSnapshot('{')).toBeNull()
    expect(
      readConversationSnapshot(
        JSON.stringify({ type: 'conversation_snapshot', history: { items: [{}] } })
      )
    ).toBeNull()
  })

  it('delayed running snapshots cannot overwrite terminal state or newer active text', () => {
    const completed = page('Completed')
    expect(
      mergeConversationHistory(completed, page('Running', 'Old'), 'snapshot').items
    ).toEqual(completed.items)
    const running = page('Running', 'Longer saved answer')
    expect(
      mergeConversationHistory(running, page('Running', 'Short'), 'snapshot').items
    ).toEqual(running.items)
  })

  it('uses authoritative terminal partial text and rejects older policy revisions', () => {
    const running = page('Running', 'Live text beyond persisted text')
    const terminal = page('Interrupted', 'Saved')
    expect(mergeConversationHistory(running, terminal, 'snapshot').items).toEqual(
      terminal.items
    )
    expect(
      mergeConversationHistory({ ...terminal, policyRevision: 2 }, running, 'snapshot')
        .policyRevision
    ).toBe(2)
  })

  it('reopens pagination when reconnect catches up beyond the loaded history', () => {
    const initial = { ...page('Completed'), nextCursor: null }
    const latest: ConversationHistory = {
      ...page('Completed'),
      nextCursor: 'q12',
      items: Array.from({ length: 30 }, (_, index) => ({
        question: {
          id: `q${index + 12}`,
          createdAt: `2026-09-15T11:${String(index).padStart(2, '0')}:00Z`,
          text: 'Later question',
          taskId: null
        },
        attempts: []
      }))
    }
    const caughtUp = mergeConversationHistory(initial, latest, 'snapshot')
    expect(caughtUp.nextCursor).toBe('q12')
    expect(caughtUp.items).toEqual(latest.items)
    // A delayed pre-reconnect HTTP read must not rewind the new snapshot.
    expect(mergeConversationHistory(caughtUp, initial, 'snapshot')).toEqual(caughtUp)
    const missingPage: ConversationHistory = {
      ...initial,
      items: [
        ...initial.items,
        ...Array.from({ length: 10 }, (_, index) => ({
          question: {
            id: `q${index + 2}`,
            createdAt: `2026-09-15T10:${String(index + 1).padStart(2, '0')}:00Z`,
            text: 'Intervening question',
            taskId: null
          },
          attempts: []
        }))
      ]
    }
    const restored = mergeConversationHistory(caughtUp, missingPage, 'page')
    expect(restored.items.map((item) => item.question.id)).toEqual(
      Array.from({ length: 41 }, (_, index) => `q${index + 1}`)
    )
    expect(restored.nextCursor).toBeNull()
  })

  it('keeps older loaded questions when latest snapshots arrive', () => {
    const recent = page()
    const older: ConversationHistory = {
      ...recent,
      nextCursor: null,
      items: recent.items.map((item) => ({
        ...item,
        question: { ...item.question, id: 'q0', createdAt: '2026-09-14T10:00:00Z' }
      }))
    }
    const combined = mergeConversationHistory(recent, older, 'page')
    expect(
      mergeConversationHistory(combined, recent, 'snapshot').items.map(
        (item) => item.question.id
      )
    ).toEqual(['q0', 'q1'])
    expect(combined.nextCursor).toBeNull()
  })
})
