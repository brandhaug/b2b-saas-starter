import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
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
    expect(screen.getByText('<script>private</script>')).toBeTruthy()
    expect(screen.getByText('wh_operations')).toBeTruthy()
    expect(screen.getByText('2026-06-02T10:00:00.000Z')).toBeTruthy()
    expect(screen.getByText(/"attempts": 3/)).toBeTruthy()
    expect(screen.getByText(/"responseStatus": 503/)).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(close).toHaveBeenCalledOnce()
  })
})
