import { NOTIFICATION_PREVIEW_PROPS } from '../notification-emails.ts'
import { NotificationEmail } from '../notification-templates.tsx'

export default function Preview(props: Parameters<typeof NotificationEmail>[0]) {
  return <NotificationEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  kind: 'billing.plan_changed',
  ...NOTIFICATION_PREVIEW_PROPS['billing.plan_changed'],
  locale: 'en'
} satisfies Parameters<typeof NotificationEmail>[0]
