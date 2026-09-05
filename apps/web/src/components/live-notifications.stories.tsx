import { type Meta, type StoryObj } from '@storybook/react-vite'
import { LiveNotifications, type NotificationPreview } from './live-notifications'

/**
 * The production notifications card (`LiveNotifications`), driven through its
 * `listNotifications` port so Storybook shows the real markup — not a
 * hand-rolled copy that drifts from the app.
 */

const notifications: ReadonlyArray<NotificationPreview> = [
  {
    id: 'n1',
    title: 'Catalog refreshed',
    message: 'Background job retried 14 deliveries at 09:12.',
    read: false,
    createdAt: '2026-09-04T09:12:00.000Z'
  },
  {
    id: 'n2',
    title: 'New audit event',
    message: 'API token "MCP local client" created with admin scope.',
    read: false,
    createdAt: '2026-09-04T08:40:00.000Z'
  },
  {
    id: 'n3',
    title: 'Weekly report ready',
    message: "This week's delivery report is available for review.",
    read: true,
    createdAt: '2026-09-01T08:00:00.000Z'
  }
]

const meta = {
  title: 'Workspace/Notifications',
  component: LiveNotifications
} satisfies Meta<typeof LiveNotifications>

export default meta
type Story = StoryObj<typeof meta>

/** The card before the client query resolves: the loader's fallback rows. */
export const Mixed: Story = {
  args: {
    workspaceSlug: 'starter-lab',
    fallback: notifications,
    listNotifications: async () => notifications
  }
}

export const Empty: Story = {
  args: {
    workspaceSlug: 'starter-lab',
    fallback: [],
    listNotifications: async () => []
  }
}
