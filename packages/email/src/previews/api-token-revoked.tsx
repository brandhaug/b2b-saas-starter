import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'api_token.revoked',
    NOTIFICATION_PREVIEW_PROPS['api_token.revoked']
  )
}
