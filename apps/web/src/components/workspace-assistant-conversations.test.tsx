import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { WorkspaceAssistantConversations } from './workspace-assistant-conversations'
import { type ConversationPorts } from '@/lib/server/assistant-conversations'

it('excludes simultaneous creates and ignores completion after leaving the directory', async () => {
  let finish: (() => void) | undefined
  const create = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<ConversationPorts['create']>>>((resolve) => {
        finish = () =>
          resolve({
            ok: true,
            value: {
              id: 'conversation_new',
              workspaceId: 'workspace_1',
              createdAt: '2026-10-30T00:00:00Z',
              title: null,
              activeAttempt: null,
              policyRevision: 1
            }
          })
      })
  )
  const select = vi.fn()
  const ports: ConversationPorts = {
    list: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [], nextCursor: null } }),
    create,
    history: vi.fn(),
    send: vi.fn(),
    retry: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn()
  }
  const view = await renderWithRouter(
    <WorkspaceAssistantConversations
      workspaceSlug="starter-lab"
      configured
      taskIds={[]}
      onSelectTask={vi.fn()}
      persistent={{ ports, onSelectConversation: select }}
    />
  )
  const button = screen.getByRole('button', { name: 'New conversation' })
  act(() => {
    fireEvent.click(button)
    fireEvent.click(button)
  })
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => {
    finish?.()
  })
  expect(select).not.toHaveBeenCalled()
})
