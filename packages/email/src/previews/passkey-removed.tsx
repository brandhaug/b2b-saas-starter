import { PasskeyChangedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof PasskeyChangedEmail>[0]) {
  return <PasskeyChangedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = { added: false, locale: 'en' } satisfies Parameters<
  typeof PasskeyChangedEmail
>[0]
