import { screen } from '@testing-library/dom'
import { expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { flagsForPage } from '@/foldkit/workspace/flags'
import { demoFixtures } from '@/lib/demo-fixtures'
import { type PageData } from '@/http/page-contract'
import { listNotificationsServerFn } from '@/lib/server/notifications'

vi.mock('@/lib/server/notifications', () => ({
  listNotificationsServerFn: vi.fn(),
  markNotificationsReadServerFn: vi.fn()
}))

// There is no query cache in the native app. The private page payload is the
// retained state: preview must ignore it, leave it intact and perform no live read.
it('does not reuse signed-in notification data or overwrite its cache', async () => {
  const privatePage = {
    ...demoFixtures.dashboard,
    notifications: [
      {
        id: 'private-notice',
        kind: 'announcement' as const,
        title: 'Private workspace activity',
        message: 'Confidential detail',
        read: false,
        createdAt: '2026-09-01T12:00:00.000Z'
      }
    ]
  }
  const data: PageData = {
    root: null,
    session: null,
    directory: [],
    suspension: null,
    page: { _tag: 'dashboard', data: privatePage },
    locale: 'en',
    presentation: { timeZone: 'UTC', authenticated: true, needsTimeZone: false },
    status: 200,
    error: null
  }
  const before = structuredClone(data)
  const flags = flagsForPage(new URL('/demo', window.location.origin), data)
  await renderWorkspace(flags.page, {
    url: '/demo',
    model: (model) => ({ ...model, flags })
  })
  expect(screen.queryByText('Confidential detail')).toBeNull()
  for (const notification of demoFixtures.dashboard.notifications) {
    expect(screen.getByText(notification.message)).toBeDefined()
  }
  expect(data).toEqual(before)
  expect(listNotificationsServerFn).not.toHaveBeenCalled()
})
