import { TwoFactorChangedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof TwoFactorChangedEmail>[0]) {
  return <TwoFactorChangedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = { enabled: false, locale: 'en' } satisfies Parameters<
  typeof TwoFactorChangedEmail
>[0]
