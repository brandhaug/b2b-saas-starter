import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'account.impersonated',
    NOTIFICATION_PREVIEW_PROPS['account.impersonated']
  )
}
