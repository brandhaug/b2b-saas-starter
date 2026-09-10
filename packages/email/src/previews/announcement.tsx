import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'announcement',
    NOTIFICATION_PREVIEW_PROPS['announcement']
  )
}
