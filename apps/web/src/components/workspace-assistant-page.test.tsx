import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { WorkspaceAssistantPage, type AskAssistant } from './workspace-assistant-page'
import { type AssistantPagePayload } from '@/lib/server/assistant'
import { m } from '@b2b-saas-starter/i18n/messages'
import { renderWithRouter } from '@/test/router-harness'

// The page's one server call, as a port — a real function of the declared
// shape, so the module under test is the one that ships.
const ask = vi.fn<AskAssistant>()

const configured: AssistantPagePayload = {
  viewer: { role: 'member' },
  configured: true
}

const unconfigured: AssistantPagePayload = {
  viewer: { role: 'member' },
  configured: false
}

// Rendered under a real router because the shell's nav uses `Link` — same
// harness the settings page tests use; no route tree, no mocked module.
async function renderPage(data: AssistantPagePayload) {
  await renderWithRouter(
    <WorkspaceAssistantPage workspaceSlug="starter-lab" data={data} ask={ask} />,
    { path: '/workspaces/starter-lab/assistant' }
  )
}

describe('WorkspaceAssistantPage', () => {
  it('hides the form and shows honest copy when no provider is configured', async () => {
    ask.mockReturnValue(new Promise(() => {}))
    await renderPage(unconfigured)
    screen.getByText(m.assistant_chat_unavailable())
    expect(screen.queryByLabelText('Your question')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('sends the question and renders the answer with its provider', async () => {
    ask.mockResolvedValue({
      ok: true,
      answer: 'Two webhooks were updated this week.',
      provider: 'workers-ai',
      modelId: '@cf/meta/llama-3.1-8b-instruct'
    })
    await renderPage(configured)
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'What changed?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', question: 'What changed?' }
      })
    )
    await waitFor(() => {
      screen.getByText('Two webhooks were updated this week.')
    })
    screen.getByText('Workers AI')
  })

  it('clears the pending action after a transport failure', async () => {
    ask.mockRejectedValue(new Error('offline'))
    await renderPage(configured)
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'Hi' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => screen.getByText(m.assistant_unreachable()))
    expect(screen.getByLabelText('Your question')).toHaveProperty('disabled', false)
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'Try again' }
    })
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('sends the selected saved investigation as model context', async () => {
    ask.mockResolvedValue({ ok: false, reason: 'unavailable', message: 'Unavailable' })
    await renderWithRouter(
      <WorkspaceAssistantPage
        workspaceSlug="starter-lab"
        data={configured}
        ask={ask}
        selectedTaskId="task_selected"
      />,
      { path: '/workspaces/starter-lab/assistant' }
    )
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'Explain the evidence' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          question: 'Explain the evidence',
          taskId: 'task_selected'
        }
      })
    )
  })

  it('renders an unavailable answer inline as the outcome message', async () => {
    ask.mockResolvedValue({
      ok: false,
      reason: 'unavailable',
      message: 'The assistant could not answer right now (workers-ai: status 500).'
    })
    await renderPage(configured)
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'Hi' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => {
      screen.getByText(/could not answer right now/)
    })
  })
})
