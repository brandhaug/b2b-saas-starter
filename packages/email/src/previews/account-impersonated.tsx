import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="account.impersonated"
      {...NOTIFICATION_PREVIEW_PROPS['account.impersonated']}
    />
  )
}
