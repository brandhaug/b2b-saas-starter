import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'webhook.delivery_failed',
    NOTIFICATION_PREVIEW_PROPS['webhook.delivery_failed']
  )
}
