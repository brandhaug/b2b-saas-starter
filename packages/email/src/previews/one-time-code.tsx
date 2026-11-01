import { OneTimeCodeEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof OneTimeCodeEmail>[0]) {
  return <OneTimeCodeEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...OneTimeCodeEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof OneTimeCodeEmail>[0]
