import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { TableViewControls } from './table-view-controls'
import { AuditEventSheet } from './audit-event-sheet'
import { renderWithRouter } from '@/test/router-harness'

describe('AuditEventSheet', () => {
  it('renders permitted metadata as text with full actor and target context', async () => {
    const close = vi.fn()
    await renderWithRouter(
      <AuditEventSheet
        eventId="aud_delivery"
        onClose={close}
        event={{
          id: 'aud_delivery',
          eventType: 'webhook.delivery_failed',
          actor: '<script>private</script>',
          actorType: 'system',
          actorUserId: null,
          targetType: 'webhook_endpoint',
          targetId: 'wh_operations',
          createdAt: '2026-06-02T10:00:00.000Z',
          metadata: { attempts: 3, responseStatus: 503 }
        }}
      />
    )
    expect(screen.getByText('<script>private</script>')).not.toBeNull()
    expect(screen.getByText('wh_operations')).not.toBeNull()
    expect(screen.getByText('2026-06-02T10:00:00.000Z')).not.toBeNull()
    expect(screen.getByText(/"attempts": 3/)).not.toBeNull()
    expect(screen.getByText(/"responseStatus": 503/)).not.toBeNull()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('restores focus to a replacement event link after the list rerenders', async () => {
    const close = vi.fn()
    const first = render(
      <>
        <a key="original" id="audit-event-aud_1" href="/audit?event=aud_1">
          Original event link
        </a>
        <AuditEventSheet eventId="aud_1" event={null} onClose={close} />
      </>
    )
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull())

    first.rerender(
      <>
        <a key="replacement" id="audit-event-aud_1" href="/audit?event=aud_1">
          Replacement event link
        </a>
        <AuditEventSheet eventId="aud_1" event={null} onClose={close} />
      </>
    )
    const replacement = document.getElementById('audit-event-aud_1')
    expect(replacement).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    first.rerender(
      <>
        <a key="replacement" id="audit-event-aud_1" href="/audit?event=aud_1">
          Replacement event link
        </a>
        <AuditEventSheet eventId={null} event={null} onClose={close} />
      </>
    )

    await waitFor(() => expect(document.activeElement).toBe(replacement))
  })

  it('restores focus to the shared filter trigger when the event is outside the list', async () => {
    const close = vi.fn()
    function content(eventId: string | null) {
      return (
        <>
          <div id="audit-view-controls">
            <TableViewControls
              fields={[]}
              view={{ match: 'all', filters: [], sorts: [] }}
              onChange={vi.fn()}
            />
          </div>
          <AuditEventSheet eventId={eventId} event={null} onClose={close} />
        </>
      )
    }
    const rendered = render(content('aud_hidden'))
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    rendered.rerender(content(null))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Filter' })
      )
    )
  })
})
