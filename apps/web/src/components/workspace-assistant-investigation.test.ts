import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { input } from './native-test-harness'
import * as Api from '@/lib/server/assistant-tasks'
import * as Conversations from '@/lib/server/assistant-conversations'
import { type WebhookInvestigationTask } from '@b2b-saas-starter/capabilities/developer-platform/webhook-investigation-tasks'

function task(
  overrides: Partial<WebhookInvestigationTask> = {}
): WebhookInvestigationTask {
  return {
    id: 'task_1',
    sourceDeliveryId: 'whd_failed',
    requestedBy: 'usr_demo',
    question: 'Investigate this delivery',
    status: 'proposed',
    diagnosis: 'receiver_unavailable',
    evidence: {
      endpointId: 'ep_1',
      endpointUrl: 'https://example.test/hook',
      eventType: 'invoice.created',
      deliveryStatus: 'dead_lettered',
      lastResponseStatus: 503,
      attempts: [
        {
          id: 'attempt_1',
          attemptedAt: '2026-09-12T10:00:00Z',
          responseStatus: 503,
          status: 'failed'
        }
      ]
    },
    replayDeliveryId: null,
    outcome: null,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-12T10:00:00Z',
    ...overrides
  }
}

type AssistantInvestigationPorts = {
  tasks: ReadonlyArray<WebhookInvestigationTask>
  get?: typeof Api.getAssistantTaskServerFn
  create: typeof Api.createAssistantTaskServerFn
  approve: typeof Api.approveAssistantTaskServerFn
  cancel: typeof Api.cancelAssistantTaskServerFn
}
async function act<A>(action: () => A | Promise<A>) {
  return action()
}
async function renderWorkbench(
  ports: AssistantInvestigationPorts,
  url = '/workspaces/starter-lab/assistant',
  role: 'owner' | 'admin' | 'member' = 'owner'
) {
  vi.spyOn(Api, 'getAssistantTaskServerFn').mockImplementation(
    ports.get ??
      (async ({ data }) =>
        ports.tasks.find((item) => item.id === data.taskId) ?? task())
  )
  vi.spyOn(Api, 'createAssistantTaskServerFn').mockImplementation(ports.create)
  vi.spyOn(Api, 'approveAssistantTaskServerFn').mockImplementation(ports.approve)
  vi.spyOn(Api, 'cancelAssistantTaskServerFn').mockImplementation(ports.cancel)
  vi.spyOn(Conversations, 'listConversationsServerFn').mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null }
  })
  vi.spyOn(Conversations, 'conversationHistoryServerFn').mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null, policyRevision: 1 }
  })
  await renderWorkspace(
    {
      _tag: 'assistant',
      data: {
        configured: true,
        viewer: { role },
        investigations: { tasks: ports.tasks, deliveries: [] }
      }
    },
    { url }
  )
  return {
    router: {
      state: {
        get location() {
          return { searchStr: window.location.search }
        }
      },
      history: window.history
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('WorkspaceAssistantInvestigation', () => {
  it('does not attach another delivery task when opening a new investigation', async () => {
    const ask = vi
      .spyOn(Conversations, 'sendConversationServerFn')
      .mockImplementation(() => new Promise(() => {}))
    const get = vi.fn().mockResolvedValue(task())
    await renderWorkbench(
      {
        tasks: [task()],
        get,
        create: vi.fn(),
        approve: vi.fn(),
        cancel: vi.fn()
      },
      '/workspaces/starter-lab/assistant?deliveryId=whd_new&conversationId=c1'
    )
    expect(screen.queryByRole('button', { name: 'Approve replay' })).toBeNull()
    expect(get).not.toHaveBeenCalled()
    await input(screen.getByLabelText('Your question'), 'Investigate this delivery')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          conversationId: 'c1',
          question: 'Investigate this delivery',
          idempotencyKey: expect.any(String)
        }
      })
    )
  })

  it('creates a proposal and approves it while preserving pending outcome', async () => {
    const create = vi.fn().mockResolvedValue(task())
    const approve = vi
      .fn()
      .mockResolvedValue(
        task({ status: 'approved', outcome: 'pending', replayDeliveryId: 'replay_1' })
      )
    const ports = {
      tasks: [],
      create,
      approve,
      cancel: vi.fn()
    } satisfies AssistantInvestigationPorts
    await renderWorkbench(ports)
    await input(screen.getByLabelText('Delivery ID'), 'whd_failed')
    fireEvent.click(screen.getByRole('button', { name: 'Investigate delivery' }))
    await waitFor(() => screen.getByRole('button', { name: /invoice.created/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve replay' }))
    await waitFor(() => screen.getByText('Replay outcome: pending'))
    expect(approve).toHaveBeenCalledWith({
      data: { workspaceSlug: 'starter-lab', taskId: 'task_1' }
    })
  })

  it('keeps local selection and resets the action after a transport failure', async () => {
    const ports = {
      tasks: [
        task(),
        task({
          id: 'task_2',
          sourceDeliveryId: 'whd_two',
          evidence: { ...task().evidence, eventType: 'customer.updated' }
        })
      ],
      create: vi.fn().mockRejectedValue(new Error('offline')),
      approve: vi.fn(),
      cancel: vi.fn()
    } satisfies AssistantInvestigationPorts
    await renderWorkbench(ports)
    fireEvent.click(screen.getByRole('button', { name: /customer.updated/ }))
    await screen.findByText('whd_two')
    await input(screen.getByLabelText('Delivery ID'), 'bad_delivery')
    fireEvent.click(screen.getByRole('button', { name: 'Investigate delivery' }))
    await waitFor(() => screen.getByText('The investigation action failed. Try again.'))
    expect(screen.getByRole('button', { name: 'Investigate delivery' })).toHaveProperty(
      'disabled',
      false
    )
  })
})

describe('saved investigations', () => {
  it('polls a restored pending replay until delivered, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pending = task({
      status: 'approved',
      replayDeliveryId: 'replay_1',
      outcome: 'pending'
    })
    const get = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(task({ ...pending, outcome: 'delivered' }))
    await renderWorkbench({
      tasks: [pending],
      get,
      create: vi.fn(),
      approve: vi.fn(),
      cancel: vi.fn()
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    screen.getByText('Replay outcome: pending')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await waitFor(() => screen.getByText('Replay outcome: delivered'))
    expect(screen.queryByRole('button', { name: 'Retry replay' })).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('shows refresh failures and can retry a read without approving again', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(task())
    const approve = vi.fn()
    await renderWorkbench({
      tasks: [task()],
      get,
      create: vi.fn(),
      approve,
      cancel: vi.fn()
    })
    await waitFor(() => screen.getByRole('alert'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh task' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(approve).not.toHaveBeenCalled()
  })

  it('recovers committed approval after queue failure and retries the saved task', async () => {
    const approved = task({
      status: 'approved',
      replayDeliveryId: 'replay_task_1',
      outcome: 'unavailable'
    })
    const get = vi.fn().mockResolvedValueOnce(task()).mockResolvedValue(approved)
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValue(approved)
    await renderWorkbench({
      tasks: [task()],
      get,
      create: vi.fn(),
      approve,
      cancel: vi.fn()
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Approve replay' }))
    await waitFor(() => screen.getByText('Replay outcome: unavailable'))
    screen.getByText('replay_task_1')
    expect(screen.queryByRole('button', { name: 'Approve replay' })).toBeNull()
    const retry = screen.getByRole('button', { name: 'Retry replay' })
    expect(retry).toHaveProperty('disabled', false)
    fireEvent.click(retry)
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2))
    expect(approve).toHaveBeenLastCalledWith({
      data: { workspaceSlug: 'starter-lab', taskId: 'task_1' }
    })
  })

  it('uses URL selection on back and forward and ignores an out-of-order task read', async () => {
    const first = deferred<WebhookInvestigationTask>()
    const second = task({
      id: 'task_2',
      sourceDeliveryId: 'whd_two',
      question: 'Second task',
      evidence: { ...task().evidence, eventType: 'customer.updated' }
    })
    const get = vi
      .fn()
      .mockImplementation(({ data }: { data: { taskId: string } }) =>
        data.taskId === 'task_1' ? first.promise : Promise.resolve(second)
      )
    const ports = {
      tasks: [task(), second],
      get,
      create: vi.fn(),
      approve: vi.fn(),
      cancel: vi.fn()
    }
    const { router } = await renderWorkbench(
      ports,
      '/workspaces/starter-lab/assistant?taskId=task_1'
    )
    fireEvent.click(screen.getByRole('button', { name: /customer.updated/ }))
    await waitFor(() => expect(router.state.location.searchStr).toContain('task_2'))
    await act(async () => {
      first.resolve(task())
    })
    expect(
      within(screen.getByRole('article', { name: 'Webhook investigation' })).getByText(
        'whd_two'
      )
    ).toBeTruthy()
    await act(async () => {
      router.history.back()
    })
    await waitFor(() =>
      within(screen.getByRole('article', { name: 'Webhook investigation' })).getByText(
        'whd_failed'
      )
    )
    await act(async () => {
      router.history.forward()
    })
    await waitFor(() =>
      within(screen.getByRole('article', { name: 'Webhook investigation' })).getByText(
        'whd_two'
      )
    )
  })

  it('persists the request and selects the created task in the URL', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(task({ question: 'Why did billing stop?' }))
    const ports = { tasks: [], create, approve: vi.fn(), cancel: vi.fn() }
    const { router } = await renderWorkbench(ports)
    await input(screen.getByLabelText('Delivery ID'), 'whd_failed')
    await input(screen.getByLabelText('Investigation request'), 'Why did billing stop?')
    fireEvent.click(screen.getByRole('button', { name: 'Investigate delivery' }))
    await waitFor(() => expect(router.state.location.searchStr).toContain('task_1'))
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_failed',
        question: 'Why did billing stop?'
      }
    })
    within(screen.getByRole('article', { name: 'Webhook investigation' })).getByText(
      'Why did billing stop?'
    )
  })

  it('requires explicit replay permission and explains disabled approval', async () => {
    const approve = vi.fn()
    await renderWorkbench(
      { tasks: [task()], create: vi.fn(), approve, cancel: vi.fn() },
      '/workspaces/starter-lab/assistant',
      'member'
    )
    expect(screen.getByRole('button', { name: 'Approve replay' })).toHaveProperty(
      'disabled',
      true
    )
    screen.getByText(/permission/i)
    expect(approve).not.toHaveBeenCalled()
  })
})

function deferred<A>() {
  let settle: ((value: A) => void) | undefined
  const promise = new Promise<A>((resolve) => {
    settle = resolve
  })
  if (settle === undefined) {
    throw new Error('Promise executor did not run synchronously')
  }
  return { promise, resolve: settle }
}
