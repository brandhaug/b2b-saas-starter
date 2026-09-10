import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'billing.plan_changed',
    NOTIFICATION_PREVIEW_PROPS['billing.plan_changed']
  )
}
