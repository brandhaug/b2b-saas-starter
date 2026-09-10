import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="two_factor.changed"
      {...NOTIFICATION_PREVIEW_PROPS['two_factor.changed']}
    />
  )
}
