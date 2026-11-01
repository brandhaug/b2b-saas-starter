import { RecoveryStartedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof RecoveryStartedEmail>[0]) {
  return <RecoveryStartedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = { locale: 'en' } satisfies Parameters<
  typeof RecoveryStartedEmail
>[0]
