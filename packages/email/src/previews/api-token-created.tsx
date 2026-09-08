import { ApiTokenCreatedEmail } from '../notification-templates.tsx'

export default function Preview() {
  return <ApiTokenCreatedEmail {...ApiTokenCreatedEmail.PreviewProps} />
}
