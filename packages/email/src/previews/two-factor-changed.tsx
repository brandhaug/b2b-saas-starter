import { TwoFactorChangedNotificationEmail } from '../notification-templates.tsx'

export default function Preview() {
  return (
    <TwoFactorChangedNotificationEmail
      {...TwoFactorChangedNotificationEmail.PreviewProps}
    />
  )
}
