import { describe, expect, it, vi } from 'vite-plus/test'
import { loadAdminPage } from './admin-loader'
import { loadFailedDeliveriesServerFn } from './admin'

vi.mock('./admin', () => ({
  listSystemUsersServerFn: vi.fn().mockResolvedValue([]),
  loadAdminAuditEventsServerFn: vi.fn().mockResolvedValue([]),
  loadFailedDeliveriesServerFn: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null }),
  listAdminWorkspacesServerFn: vi.fn().mockResolvedValue([])
}))
vi.mock('./email-delivery', () => ({
  loadSystemEmailDeliveryServerFn: vi.fn().mockResolvedValue({ records: [] })
}))

describe('admin page loader', () => {
  it('omits unset optional inputs when opening the default admin page', async () => {
    await loadAdminPage()
    expect(loadFailedDeliveriesServerFn).toHaveBeenLastCalledWith({ data: {} })
  })

  it('discards invalid views and retains a supplied cursor', async () => {
    await loadAdminPage({ view: '{invalid', cursor: 'next-page' })
    expect(loadFailedDeliveriesServerFn).toHaveBeenLastCalledWith({
      data: { cursor: 'next-page' }
    })
  })
})
