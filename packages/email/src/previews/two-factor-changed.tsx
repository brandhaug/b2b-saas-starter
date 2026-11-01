import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview(props: Parameters<typeof NotificationEmail>[0]) {
  return <NotificationEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  kind: 'two_factor.changed',
  ...NOTIFICATION_PREVIEW_PROPS['two_factor.changed'],
  locale: 'en'
} satisfies Parameters<typeof NotificationEmail>[0]
