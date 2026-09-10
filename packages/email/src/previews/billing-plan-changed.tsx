import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="billing.plan_changed"
      {...NOTIFICATION_PREVIEW_PROPS['billing.plan_changed']}
    />
  )
}
