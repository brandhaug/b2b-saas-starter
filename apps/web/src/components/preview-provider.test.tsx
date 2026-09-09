import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { notificationsQueryKey } from '@/lib/server/notifications'
import { LiveNotifications, type NotificationPreview } from './live-notifications'
import { PreviewProvider } from './preview-provider'

it('does not reuse signed-in notification data or overwrite its cache', async () => {
  const client = new QueryClient()
  const privateNotifications = [
    {
      id: 'private-notice',
      title: 'Private workspace activity',
      message: 'Confidential detail',
      read: false,
      createdAt: '2026-09-01T12:00:00.000Z'
    }
  ] satisfies ReadonlyArray<NotificationPreview>
  const samples = [
    {
      id: 'sample-notice',
      title: 'Example activity',
      message: 'Synthetic notification',
      read: false,
      createdAt: '2026-09-01T12:00:00.000Z'
    }
  ] satisfies ReadonlyArray<NotificationPreview>
  const key = notificationsQueryKey('starter-lab')
  client.setQueryData(key, privateNotifications)
  await renderWithRouter(
    <QueryClientProvider client={client}>
      <PreviewProvider>
        <LiveNotifications
          workspaceSlug="starter-lab"
          fallback={samples}
          listNotifications={async () => samples}
        />
      </PreviewProvider>
    </QueryClientProvider>,
    { path: '/demo' }
  )
  await screen.findByText('Synthetic notification')
  expect(screen.queryByText('Confidential detail')).toBeNull()
  expect(client.getQueryData(key)).toEqual(privateNotifications)
})
