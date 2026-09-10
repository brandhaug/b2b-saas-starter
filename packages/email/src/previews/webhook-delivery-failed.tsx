import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="webhook.delivery_failed"
      {...NOTIFICATION_PREVIEW_PROPS['webhook.delivery_failed']}
    />
  )
}
