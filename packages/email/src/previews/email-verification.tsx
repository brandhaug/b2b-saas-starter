import { EmailVerificationEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof EmailVerificationEmail>[0]) {
  return <EmailVerificationEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...EmailVerificationEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof EmailVerificationEmail>[0]
