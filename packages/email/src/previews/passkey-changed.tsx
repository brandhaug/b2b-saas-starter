import { PasskeyChangedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof PasskeyChangedEmail>[0]) {
  return <PasskeyChangedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...PasskeyChangedEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof PasskeyChangedEmail>[0]
