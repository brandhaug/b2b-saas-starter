import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'workspace_member.role_changed',
    NOTIFICATION_PREVIEW_PROPS['workspace_member.role_changed']
  )
}
