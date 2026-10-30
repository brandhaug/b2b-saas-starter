import { act, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { readonly children: ReactNode }) => {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
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
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations),
      { wrapper: queryWrapper() }
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
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations),
      { wrapper: queryWrapper() }
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
    await waitFor(() => expect(view.result.current.history).toEqual(later))
    view.unmount()
  })

  it('clears protected content on expiry and establishes a fresh observer on reconnect', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations),
      { wrapper: queryWrapper() }
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

  it('closes the socket when an HTTP read revokes access', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    vi.mocked(operations.history).mockResolvedValue({
      ok: false,
      reason: 'access',
      message: 'Access lost',
      retryAfterSeconds: null
    })
    const onAccessLost = vi.fn()
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations, onAccessLost),
      { wrapper: queryWrapper() }
    )
    await waitFor(() => expect(view.result.current.connection).toBe('denied'))
    expect(ObserverSocket.instances[0]?.close).toHaveBeenCalledOnce()
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.error).toBe('Access lost')
    expect(onAccessLost).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('ends loading on socket denial and ignores the pending HTTP response', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    let resolve!: (value: ConversationResult<ConversationHistory>) => void
    const pending = new Promise<ConversationResult<ConversationHistory>>((_resolve) => {
      resolve = _resolve
    })
    vi.mocked(operations.history).mockReturnValueOnce(pending)
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations),
      { wrapper: queryWrapper() }
    )
    await act(() =>
      ObserverSocket.instances[0]?.dispatchEvent(
        new CloseEvent('close', { code: 4403 })
      )
    )
    expect(view.result.current.connection).toBe('denied')
    expect(view.result.current.loading).toBe(false)
    await act(async () => {
      resolve({ ok: true, value: empty })
      await pending
    })
    expect(view.result.current.history).toBeNull()
    view.unmount()
  })

  it('isolates a new selection from late reads and socket frames', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    let resolve!: (value: ConversationResult<ConversationHistory>) => void
    const pending = new Promise<ConversationResult<ConversationHistory>>((_resolve) => {
      resolve = _resolve
    })
    vi.mocked(operations.history).mockReturnValueOnce(pending)
    const view = renderHook(
      ({ id }) => useAssistantConversation('starter-lab', id, operations),
      { initialProps: { id: 'c1' }, wrapper: queryWrapper() }
    )
    view.rerender({ id: 'c2' })
    await waitFor(() => expect(view.result.current.history).toEqual(empty))
    const stale = { ...empty, nextCursor: 'old-conversation' }
    await act(async () => {
      resolve({ ok: true, value: stale })
      await pending
      ObserverSocket.instances[0]?.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'conversation_snapshot', history: stale })
        })
      )
    })
    expect(view.result.current.history).toEqual(empty)
    expect(ObserverSocket.instances[0]?.close).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('deduplicates repeated requests for the same older page', async () => {
    vi.stubGlobal('WebSocket', ObserverSocket)
    const operations = ports()
    let resolve!: (value: ConversationResult<ConversationHistory>) => void
    const pending = new Promise<ConversationResult<ConversationHistory>>((_resolve) => {
      resolve = _resolve
    })
    vi.mocked(operations.history)
      .mockResolvedValueOnce({ ok: true, value: { ...empty, nextCursor: 'older' } })
      .mockReturnValue(pending)
    const view = renderHook(
      () => useAssistantConversation('starter-lab', 'c1', operations),
      { wrapper: queryWrapper() }
    )
    await waitFor(() => expect(view.result.current.history?.nextCursor).toBe('older'))
    await act(async () => {
      void view.result.current.loadOlder()
      void view.result.current.loadOlder()
    })
    expect(operations.history).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolve({ ok: true, value: empty })
      await pending
    })
    view.unmount()
  })
})
