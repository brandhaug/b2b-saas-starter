import { PasswordResetEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof PasswordResetEmail>[0]) {
  return <PasswordResetEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...PasswordResetEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof PasswordResetEmail>[0]
