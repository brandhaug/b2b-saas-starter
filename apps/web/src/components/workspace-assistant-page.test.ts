import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { type AssistantPagePayload } from '@/lib/server/assistant'
import * as Api from '@/lib/server/assistant-conversations'
import * as Tasks from '@/lib/server/assistant-tasks'
import { m } from '@b2b-saas-starter/i18n/messages'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { input } from './native-test-harness'

class Socket extends EventTarget {
  static current: Socket | undefined
  constructor() {
    super()
    Socket.current = this
  }
  close() {}
}
afterEach(() => {
  vi.unstubAllGlobals()
  Socket.current = undefined
})
const configured: AssistantPagePayload = {
  viewer: { role: 'member' },
  configured: true
}
const unconfigured: AssistantPagePayload = { ...configured, configured: false }

async function renderPage(data: AssistantPagePayload, selectedTaskId?: string) {
  vi.stubGlobal('WebSocket', Socket)
  vi.spyOn(Tasks, 'getAssistantTaskServerFn').mockImplementation(
    () => new Promise(() => {})
  )
  vi.spyOn(Api, 'listConversationsServerFn').mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null }
  })
  vi.spyOn(Api, 'conversationHistoryServerFn').mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null, policyRevision: 1 }
  })
  const ask = vi
    .spyOn(Api, 'sendConversationServerFn')
    .mockImplementation(() => new Promise(() => {}))
  await renderWorkspace(
    { _tag: 'assistant', data },
    {
      url: `/workspaces/starter-lab/assistant${data.configured ? '?conversationId=c1' : ''}`,
      model: (model) => ({
        ...model,
        assistant: {
          ...model.assistant,
          selectedTask: selectedTaskId
            ? {
                id: selectedTaskId,
                sourceDeliveryId: 'delivery',
                requestedBy: 'usr_demo',
                question: 'Investigate',
                status: 'proposed',
                diagnosis: 'receiver_unavailable',
                evidence: {
                  endpointId: 'endpoint',
                  endpointUrl: 'https://example.test/hook',
                  eventType: 'webhook.test_event',
                  deliveryStatus: 'failed',
                  lastResponseStatus: 503,
                  attempts: []
                },
                replayDeliveryId: null,
                outcome: null,
                createdAt: '2026-09-15T10:00:00Z',
                updatedAt: '2026-09-15T10:00:00Z'
              }
            : null
        }
      })
    }
  )
  return ask
}

// The former one-shot question port is now persisted admission plus live snapshots.
// Preserve question bytes, task context, provider rendering and failure recovery.
describe('WorkspaceAssistantPage', () => {
  it('hides the form and shows honest copy when no provider is configured', async () => {
    const ask = await renderPage(unconfigured)
    screen.getByText(m.assistant_chat_unavailable())
    screen.getByText(m.assistant_unavailable_description())
    expect(
      screen.getByRole('link', { name: m.assistant_setup_docs() }).getAttribute('href')
    ).toBe('/docs/getting-started/optional-providers')
    screen.getByText(m.assistant_example_prompt())
    expect(screen.queryByLabelText('Your question')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('sends the question and renders the answer with its provider', async () => {
    const ask = await renderPage(configured)
    await input(screen.getByLabelText('Your question'), 'What changed?')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          conversationId: 'c1',
          question: 'What changed?',
          idempotencyKey: expect.any(String)
        }
      })
    )
    Socket.current?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'conversation_snapshot',
          history: {
            policyRevision: 1,
            nextCursor: null,
            items: [
              {
                question: {
                  id: 'q1',
                  text: 'What changed?',
                  taskId: null,
                  createdAt: '2026-09-15T10:00:00Z'
                },
                attempts: [
                  {
                    id: 'a1',
                    questionId: 'q1',
                    createdAt: '2026-09-15T10:00:00Z',
                    status: 'Completed',
                    text: 'Two webhooks were updated this week.',
                    deadline: 100,
                    reason: null,
                    completedAt: '2026-09-15T10:01:00.000Z',
                    provider: 'Workers AI',
                    modelId: '@cf/meta/llama-3.1-8b-instruct',
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
        })
      })
    )
    await screen.findByText('Two webhooks were updated this week.')
    screen.getByText('Workers AI')
  })

  it('clears the pending action after a transport failure', async () => {
    const ask = await renderPage(configured)
    ask.mockRejectedValue(new Error('offline'))
    await input(screen.getByLabelText('Your question'), 'Hi')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(m.assistant_unreachable())
    expect(screen.getByLabelText('Your question')).toHaveProperty('disabled', false)
    await input(screen.getByLabelText('Your question'), 'Try again')
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('sends the selected saved investigation as model context', async () => {
    const ask = await renderPage(configured, 'task_selected')
    await input(screen.getByLabelText('Your question'), 'Explain the evidence')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          conversationId: 'c1',
          question: 'Explain the evidence',
          taskId: 'task_selected',
          idempotencyKey: expect.any(String)
        }
      })
    )
  })

  it('renders an unavailable answer inline as the outcome message', async () => {
    const ask = await renderPage(configured)
    ask.mockResolvedValue({
      ok: false,
      reason: 'unavailable',
      retryAfterSeconds: null,
      message: 'The assistant could not answer right now (workers-ai: status 500).'
    })
    await input(screen.getByLabelText('Your question'), 'Hi')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(/could not answer right now/)
  })
})
