import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'two_factor.changed',
    NOTIFICATION_PREVIEW_PROPS['two_factor.changed']
  )
}
