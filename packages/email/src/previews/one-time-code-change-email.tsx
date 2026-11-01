import { OneTimeCodeEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof OneTimeCodeEmail>[0]) {
  return <OneTimeCodeEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  code: '123456',
  purpose: 'change-email',
  locale: 'en'
} satisfies Parameters<typeof OneTimeCodeEmail>[0]
