import {
  notificationEmailFor,
  NOTIFICATION_PREVIEW_PROPS
} from '../notification-emails.ts'

export default function Preview() {
  return notificationEmailFor(
    'workspace_member.joined',
    NOTIFICATION_PREVIEW_PROPS['workspace_member.joined']
  )
}
