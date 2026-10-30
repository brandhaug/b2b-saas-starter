// @vitest-environment jsdom
/* oxlint-disable starter/no-run-promise-in-tests -- Explicitly joins observer fibers at the JSDOM WebSocket EventTarget and Promise test-runner seam. */
import { Effect, Fiber, Stream } from 'effect'
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as Api from '@/lib/server/assistant-conversations'
import { demoFixtures } from '@/lib/demo-fixtures'
import { observe } from './conversation-observer'
import { init, update } from './update'
import { renderWorkspace } from './test-harness'

class ObserverSocket extends EventTarget {
  static instances: Array<ObserverSocket> = []
  readonly close = vi.fn()
  constructor() {
    super()
    ObserverSocket.instances.push(this)
  }
}
const empty = { items: [], nextCursor: null, policyRevision: 1 }
const fibers: Array<Fiber.Fiber<void, never>> = []
afterEach(async () => {
  for (const fiber of fibers.splice(0)) {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  ObserverSocket.instances = []
})
function start() {
  vi.stubGlobal('WebSocket', ObserverSocket)
  const history = vi
    .spyOn(Api, 'conversationHistoryServerFn')
    .mockResolvedValue({ ok: true, value: empty })
  const stop = vi.spyOn(Api, 'stopConversationServerFn')
  const send = vi.spyOn(Api, 'sendConversationServerFn')
  const retry = vi.spyOn(Api, 'retryConversationServerFn')
  let model = init({
    page: { _tag: 'assistant', data: demoFixtures.assistant },
    slug: 'starter-lab',
    actorUserId: 'usr_demo',
    preview: false,
    url: 'http://localhost/workspaces/starter-lab/assistant?conversationId=c1'
  }).model
  function connect() {
    const fiber = Effect.runFork(
      observe('starter-lab', 'c1', model.assistant.generation).pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            model = update(model, message).model
          })
        )
      )
    )
    fibers.push(fiber)
    return fiber
  }
  return {
    history,
    stop,
    send,
    retry,
    connect,
    get model() {
      return model
    },
    dispatch: (message: Parameters<typeof update>[1]) => {
      model = update(model, message).model
    }
  }
}
describe('conversation observation lifetime', () => {
  it('unmount closes observation without stopping or restarting generation', async () => {
    const view = start()
    const fiber = view.connect()
    await waitFor(() => expect(view.model.assistant.history).toEqual(empty))
    ObserverSocket.instances[0]?.dispatchEvent(new Event('open'))
    await waitFor(() => expect(view.model.assistant.connection).toBe('connected'))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(ObserverSocket.instances[0]?.close).toHaveBeenCalledOnce()
    expect(view.stop).not.toHaveBeenCalled()
    expect(view.send).not.toHaveBeenCalled()
    expect(view.retry).not.toHaveBeenCalled()
    ObserverSocket.instances = []
    vi.spyOn(Api, 'createConversationServerFn').mockResolvedValue({
      ok: true,
      value: {
        id: 'c1',
        workspaceId: 'org_demo',
        createdAt: '2026-09-15T10:00:00Z',
        title: null,
        activeAttempt: null,
        policyRevision: 1
      }
    })
    vi.spyOn(Api, 'listConversationsServerFn').mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null }
    })
    const mounted = await renderWorkspace(
      { _tag: 'assistant', data: demoFixtures.assistant },
      { url: '/workspaces/starter-lab/assistant' }
    )
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    await waitFor(() => expect(ObserverSocket.instances).toHaveLength(1))
    ObserverSocket.instances[0]?.dispatchEvent(new Event('open'))
    await screen.findByText('Connected to saved history and live progress')
    mounted.unmount()
  })

  it('ignores an older-page response displaced by a catch-up snapshot', async () => {
    const view = start()
    const initial = {
      ...empty,
      nextCursor: 'q1',
      items: [
        {
          question: {
            id: 'q1',
            createdAt: '2026-09-15T10:00:00Z',
            text: 'First',
            taskId: null
          },
          attempts: []
        }
      ]
    }
    const later = {
      ...empty,
      nextCursor: 'q12',
      items: [
        {
          question: {
            id: 'q12',
            createdAt: '2026-09-15T11:00:00Z',
            text: 'Later',
            taskId: null
          },
          attempts: []
        }
      ]
    }
    view.history.mockResolvedValueOnce({ ok: true, value: initial })
    view.connect()
    await waitFor(() => expect(view.model.assistant.history).toEqual(initial))
    ObserverSocket.instances[0]?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'conversation_snapshot', history: later })
      })
    )
    await waitFor(() => expect(view.model.assistant.history).toEqual(later))
    view.dispatch({
      _tag: 'Completed',
      request: view.model.request,
      result: { _tag: 'History', cursor: 'q1', conversationId: 'c1', history: empty }
    })
    expect(view.model.assistant.history).toEqual(later)
  })

  it('clears protected content on expiry and establishes a fresh observer on reconnect', async () => {
    const view = start()
    const fiber = view.connect()
    await waitFor(() => expect(view.model.assistant.history).toEqual(empty))
    ObserverSocket.instances[0]?.dispatchEvent(new CloseEvent('close', { code: 1008 }))
    await waitFor(() => expect(view.model.assistant.connection).toBe('denied'))
    expect(view.model.assistant.history).toBeNull()
    ObserverSocket.instances[0]?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'conversation_snapshot', history: empty })
      })
    )
    expect(view.model.assistant.history).toBeNull()
    await Effect.runPromise(Fiber.interrupt(fiber))
    view.dispatch({ _tag: 'Reconnect' })
    view.connect()
    await waitFor(() => expect(view.model.assistant.history).toEqual(empty))
    expect(ObserverSocket.instances).toHaveLength(2)
    expect(view.send).not.toHaveBeenCalled()
  })
})
