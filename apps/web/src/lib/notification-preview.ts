import { type Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'

export type NotificationPreview = Pick<
  Notification,
  'id' | 'title' | 'message' | 'read' | 'createdAt'
>
