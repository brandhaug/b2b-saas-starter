import { WebhookDeliveryFailedEmail } from '../notification-templates.tsx'

export default function Preview() {
  return <WebhookDeliveryFailedEmail {...WebhookDeliveryFailedEmail.PreviewProps} />
}
