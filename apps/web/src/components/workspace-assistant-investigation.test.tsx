import { useLocation, useNavigate } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { WorkspaceAssistantPage } from './workspace-assistant-page'
import {
  WorkspaceAssistantInvestigation,
  type AssistantInvestigationPorts
} from './workspace-assistant-investigation'
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

async function renderWorkbench(ports: AssistantInvestigationPorts) {
  await renderWithRouter(
    <WorkspaceAssistantInvestigation
      workspaceSlug="starter-lab"
      investigation={ports}
      canReplay
    />,
    { path: '/workspaces/starter-lab/assistant' }
  )
}

afterEach(() => vi.useRealTimers())

describe('WorkspaceAssistantInvestigation', () => {
  it('does not attach another delivery task when opening a new investigation', async () => {
    const ask = vi.fn().mockResolvedValue({
      ok: true,
      answer: 'Ready',
      provider: 'mock',
      modelId: 'mock'
    })
    const get = vi.fn().mockResolvedValue(task())
    await renderWithRouter(
      <WorkspaceAssistantPage
        workspaceSlug="starter-lab"
        data={{ configured: true, viewer: { role: 'owner' } }}
        ask={ask}
        selectedDeliveryId="whd_new"
        investigation={{
          tasks: [task()],
          get,
          create: vi.fn(),
          approve: vi.fn(),
          cancel: vi.fn()
        }}
      />,
      { path: '/workspaces/starter-lab/assistant' }
    )
    expect(screen.queryByRole('button', { name: 'Approve replay' })).toBeNull()
    expect(get).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'Investigate this delivery' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', question: 'Investigate this delivery' }
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
    fireEvent.change(screen.getByLabelText('Delivery ID'), {
      target: { value: 'whd_failed' }
    })
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
    expect(screen.getByText('whd_two')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Delivery ID'), {
      target: { value: 'bad_delivery' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Investigate delivery' }))
    await waitFor(() => screen.getByText('The investigation action failed. Try again.'))
    expect(screen.getByRole('button', { name: 'Investigate delivery' })).toHaveProperty(
      'disabled',
      false
    )
  })
})

function UrlWorkbench({ ports }: { readonly ports: AssistantInvestigationPorts }) {
  const location = useLocation()
  const navigate = useNavigate()
  const search = new URLSearchParams(location.searchStr)
  return (
    <WorkspaceAssistantInvestigation
      workspaceSlug="starter-lab"
      investigation={ports}
      canReplay
      selectedTaskId={search.get('taskId') ?? undefined}
      onSelectTask={(taskId) =>
        void navigate({
          to: '/workspaces/$workspaceSlug/assistant',
          params: { workspaceSlug: 'starter-lab' },
          search: { taskId }
        })
      }
    />
  )
}

describe('saved investigations', () => {
  it('polls a restored pending replay until delivered, then stops', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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
    const { router } = await renderWithRouter(<UrlWorkbench ports={ports} />, {
      path: '/workspaces/starter-lab/assistant',
      initialEntry: '/workspaces/starter-lab/assistant?taskId=task_1'
    })
    fireEvent.click(screen.getByRole('button', { name: /customer.updated/ }))
    await waitFor(() => expect(router.state.location.searchStr).toContain('task_2'))
    await act(async () => {
      first.resolve(task())
    })
    expect(
      within(screen.getByRole('region', { name: 'Webhook investigation' })).getByText(
        'whd_two'
      )
    ).toBeTruthy()
    await act(async () => {
      router.history.back()
    })
    await waitFor(() =>
      within(screen.getByRole('region', { name: 'Webhook investigation' })).getByText(
        'whd_failed'
      )
    )
    await act(async () => {
      router.history.forward()
    })
    await waitFor(() =>
      within(screen.getByRole('region', { name: 'Webhook investigation' })).getByText(
        'whd_two'
      )
    )
  })

  it('persists the request and selects the created task in the URL', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(task({ question: 'Why did billing stop?' }))
    const ports = { tasks: [], create, approve: vi.fn(), cancel: vi.fn() }
    const { router } = await renderWithRouter(<UrlWorkbench ports={ports} />, {
      path: '/workspaces/starter-lab/assistant'
    })
    fireEvent.change(screen.getByLabelText('Delivery ID'), {
      target: { value: 'whd_failed' }
    })
    fireEvent.change(screen.getByLabelText('Investigation request'), {
      target: { value: 'Why did billing stop?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Investigate delivery' }))
    await waitFor(() => expect(router.state.location.searchStr).toContain('task_1'))
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_failed',
        question: 'Why did billing stop?'
      }
    })
    screen.getByText('Why did billing stop?')
  })

  it('requires explicit replay permission and explains disabled approval', async () => {
    const approve = vi.fn()
    await renderWithRouter(
      <WorkspaceAssistantInvestigation
        workspaceSlug="starter-lab"
        investigation={{ tasks: [task()], create: vi.fn(), approve, cancel: vi.fn() }}
      />
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
