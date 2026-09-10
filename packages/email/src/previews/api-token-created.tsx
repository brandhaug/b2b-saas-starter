import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="api_token.created"
      {...NOTIFICATION_PREVIEW_PROPS['api_token.created']}
    />
  )
}
