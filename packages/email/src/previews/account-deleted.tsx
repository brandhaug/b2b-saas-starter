import { AccountDeletedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof AccountDeletedEmail>[0]) {
  return <AccountDeletedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...AccountDeletedEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof AccountDeletedEmail>[0]
