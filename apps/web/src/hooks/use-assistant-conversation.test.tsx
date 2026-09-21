import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useAssistantConversation } from './use-assistant-conversation'
import {
  type ConversationPorts,
  type ConversationResult,
  type ConversationHistory
} from '@/lib/server/assistant-conversations'
class ObserverSocket extends EventTarget {
  static instances: Array<ObserverSocket> = []
  readonly close = vi.fn()
  constructor() {
    super()
    ObserverSocket.instances.push(this)
  }
}
const empty = { items: [], nextCursor: null, policyRevision: 1 }
function ports(): ConversationPorts {
  const refused: ConversationResult<never> = {
    ok: false,
    reason: 'unavailable',
    message: 'Unavailable',
    retryAfterSeconds: null
  }
  return {
    create: vi.fn(async () => refused),
    list: vi.fn(async () => refused),
    history: vi.fn(async (): Promise<ConversationResult<ConversationHistory>> => ({
      ok: true,
      value: empty
    })),
    send: vi.fn(async () => refused),
    retry: vi.fn(async () => refused),
    stop: vi.fn(async () => refused),
    remove: vi.fn(async () => refused)
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  ObserverSocket.instances = []
})
describe('conversation observation lifetime', () => {
  it('unmount closes observation without stopping or restarting generation', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    const view = renderHook(() =>
      useAssistantConversation('starter-lab', 'c1', operations)
    )
    await waitFor(() => expect(view.result.current.history).toEqual(empty))
    view.unmount()
    expect(ObserverSocket.instances[0]?.close).toHaveBeenCalledOnce()
    expect(operations.stop).not.toHaveBeenCalled()
    expect(operations.send).not.toHaveBeenCalled()
    expect(operations.retry).not.toHaveBeenCalled()
  })

  it('ignores an older-page response displaced by a catch-up snapshot', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    const initial: ConversationHistory = {
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
    const later: ConversationHistory = {
      ...initial,
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
    let resolvePage!: (result: ConversationResult<ConversationHistory>) => void
    const pendingPage = new Promise<ConversationResult<ConversationHistory>>(
      (resolve) => {
        resolvePage = resolve
      }
    )
    vi.mocked(operations.history)
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockReturnValueOnce(pendingPage)
    const view = renderHook(() =>
      useAssistantConversation('starter-lab', 'c1', operations)
    )
    await waitFor(() => expect(view.result.current.history).toEqual(initial))
    act(() => {
      void view.result.current.loadOlder()
    })
    act(() => {
      ObserverSocket.instances[0]?.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'conversation_snapshot', history: later })
        })
      )
    })
    await act(async () => {
      resolvePage({ ok: true, value: empty })
      await pendingPage
    })
    expect(view.result.current.history).toEqual(later)
    view.unmount()
  })

  it('clears protected content on expiry and establishes a fresh observer on reconnect', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    const view = renderHook(() =>
      useAssistantConversation('starter-lab', 'c1', operations)
    )
    await waitFor(() => expect(view.result.current.history).toEqual(empty))
    act(() => {
      ObserverSocket.instances[0]?.dispatchEvent(
        new CloseEvent('close', { code: 1008 })
      )
    })
    expect(view.result.current.history).toBeNull()
    expect(view.result.current.connection).toBe('denied')
    act(() => {
      ObserverSocket.instances[0]?.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'conversation_snapshot', history: empty })
        })
      )
    })
    expect(view.result.current.history).toBeNull()
    act(() => view.result.current.reconnect())
    await waitFor(() => expect(view.result.current.history).toEqual(empty))
    expect(ObserverSocket.instances).toHaveLength(2)
    expect(operations.send).not.toHaveBeenCalled()
    view.unmount()
  })
})
