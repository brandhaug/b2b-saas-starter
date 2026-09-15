import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type ConversationAnswer } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { ConversationHistoryList } from './workspace-assistant-conversations-history'
import { m } from '@b2b-saas-starter/i18n/messages'
const answer: ConversationAnswer = {
  id: 'a1',
  questionId: 'q1',
  createdAt: '2026-09-15T10:00:00Z',
  status: 'Interrupted',
  text: 'Saved partial',
  deadline: 100,
  reason: 'output_limit',
  completedAt: null,
  provider: 'Workers AI',
  modelId: null,
  providerRequestId: null,
  finishReason: null,
  inputTokens: null,
  outputTokens: null,
  omittedExchanges: 3,
  evidence: {
    taskId: 'removed-task',
    sourceId: 'source-old',
    observedAt: '2026-09-14T10:00:00Z',
    text: 'Historical evidence'
  }
}
const question = {
  id: 'q1',
  createdAt: '2026-09-15T10:00:00Z',
  text: 'Question',
  taskId: 'removed-task'
}
describe('saved conversation attempts', () => {
  it('groups retries with one question and retries only the latest incomplete attempt', () => {
    const retry = vi.fn()
    render(
      <ConversationHistoryList
        items={[
          {
            question,
            attempts: [answer, { ...answer, id: 'a2', text: 'Second partial' }]
          }
        ]}
        configured
        pending={false}
        taskIds={[]}
        onSelectTask={vi.fn()}
        onRetry={retry}
        onStop={vi.fn()}
      />
    )
    expect(screen.getAllByText('Question')).toHaveLength(1)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getAllByText(m.assistant_conversations_saved_partial())).toHaveLength(
      2
    )
    expect(
      screen.getAllByText(m.assistant_conversations_omitted({ count: 3 }))
    ).toHaveLength(2)
    const button = screen.getByRole('button', {
      name: m.assistant_conversations_retry()
    })
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledWith('a2')
  })

  it('keeps saved content visible without a provider and disables retry', () => {
    render(
      <ConversationHistoryList
        items={[{ question, attempts: [answer] }]}
        configured={false}
        pending={false}
        taskIds={[]}
        onSelectTask={vi.fn()}
        onRetry={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByText('Saved partial')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: m.assistant_conversations_retry() })
        .hasAttribute('disabled')
    ).toBe(true)
  })

  it('still permits stopping an active answer when provider configuration changes', () => {
    const stop = vi.fn()
    render(
      <ConversationHistoryList
        items={[{ question, attempts: [{ ...answer, status: 'Running' }] }]}
        configured={false}
        pending={false}
        taskIds={[]}
        onSelectTask={vi.fn()}
        onRetry={vi.fn()}
        onStop={stop}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: m.assistant_conversations_stop() })
    )
    expect(stop).toHaveBeenCalledWith('a1')
  })
})
