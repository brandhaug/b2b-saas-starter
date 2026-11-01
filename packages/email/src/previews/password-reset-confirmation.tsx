import { PasswordChangedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof PasswordChangedEmail>[0]) {
  return <PasswordChangedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = { via: 'reset', locale: 'en' } satisfies Parameters<
  typeof PasswordChangedEmail
>[0]
