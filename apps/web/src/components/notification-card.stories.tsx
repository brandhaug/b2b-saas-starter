import type { Meta, StoryObj } from '@storybook/react-vite'
import { BellIcon } from 'lucide-react'
import type { NotificationPreview } from './live-notifications'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function NotificationCard({
  notifications
}: {
  readonly notifications: readonly NotificationPreview[]
}) {
  return (
    <Card className="w-[28rem]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" /> Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notifications yet.</p>
        ) : (
          notifications.map((notification) => (
            <div key={notification.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{notification.title}</p>
                {!notification.read && <Badge>New</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {notification.message}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Workspace/NotificationCard',
  component: NotificationCard
} satisfies Meta<typeof NotificationCard>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { notifications: [] } }

export const Mixed: Story = {
  args: {
    notifications: [
      {
        id: 'n1',
        title: 'Catalog refreshed',
        message: 'Background job updated 14 modules at 09:12.',
        read: false
      },
      {
        id: 'n2',
        title: 'New audit event',
        message: 'API token "MCP local client" created with admin scope.',
        read: false
      },
      {
        id: 'n3',
        title: 'Weekly report ready',
        message: "This week's readiness report is available for review.",
        read: true
      }
    ]
  }
}
