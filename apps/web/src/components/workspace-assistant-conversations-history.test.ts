import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type ConversationAnswer } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Api from '@/lib/server/assistant-conversations'
import { m } from '@b2b-saas-starter/i18n/messages'
const answer: ConversationAnswer = {
  id: 'a1',
  questionId: 'q1',
  createdAt: '2026-09-15T10:00:00Z',
  status: 'Interrupted',
  text: 'Saved partial',
  deadline: 100,
  reason: 'output_limit',
  completedAt: '2026-09-15T10:01:00.000Z',
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
async function renderHistory(attempts: Array<ConversationAnswer>, configured: boolean) {
  const history = {
    items: [{ question, attempts }],
    nextCursor: null,
    policyRevision: 1
  }
  vi.spyOn(Api, 'conversationHistoryServerFn').mockResolvedValue({
    ok: true,
    value: history
  })
  vi.spyOn(Api, 'listConversationsServerFn').mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null }
  })
  const retry = vi
    .spyOn(Api, 'retryConversationServerFn')
    .mockImplementation(() => new Promise(() => {}))
  const stop = vi
    .spyOn(Api, 'stopConversationServerFn')
    .mockImplementation(() => new Promise(() => {}))
  await renderWorkspace(
    { _tag: 'assistant', data: { viewer: demoFixtures.assistant.viewer, configured } },
    {
      url: '/workspaces/starter-lab/assistant?conversationId=c1',
      model: (model) => ({ ...model, assistant: { ...model.assistant, history } })
    }
  )
  return { retry, stop }
}
describe('saved conversation attempts', () => {
  it('groups retries with one question and retries only the latest incomplete attempt', async () => {
    const { retry } = await renderHistory(
      [answer, { ...answer, id: 'a2', text: 'Second partial' }],
      true
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
    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith({
        data: expect.objectContaining({ conversationId: 'c1', attemptId: 'a2' })
      })
    )
  })

  it('keeps saved content visible without a provider and disables retry', async () => {
    await renderHistory([answer], false)
    expect(screen.getByText('Saved partial')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: m.assistant_conversations_retry() })
        .hasAttribute('disabled')
    ).toBe(true)
  })

  it('still permits stopping an active answer when provider configuration changes', async () => {
    const { stop } = await renderHistory(
      [{ ...answer, status: 'Running', reason: null, completedAt: null }],
      false
    )
    fireEvent.click(
      screen.getByRole('button', { name: m.assistant_conversations_stop() })
    )
    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', conversationId: 'c1', attemptId: 'a1' }
      })
    )
  })
})
