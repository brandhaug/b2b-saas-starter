import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <NotificationEmail
      kind="workspace_member.joined"
      {...NOTIFICATION_PREVIEW_PROPS['workspace_member.joined']}
    />
  )
}
