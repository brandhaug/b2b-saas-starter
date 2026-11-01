import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview(props: Parameters<typeof NotificationEmail>[0]) {
  return <NotificationEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  kind: 'announcement',
  ...NOTIFICATION_PREVIEW_PROPS['announcement'],
  workspaceName: null,
  locale: 'en'
} satisfies Parameters<typeof NotificationEmail>[0]
