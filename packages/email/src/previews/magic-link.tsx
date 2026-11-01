import { MagicLinkEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof MagicLinkEmail>[0]) {
  return <MagicLinkEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...MagicLinkEmail.PreviewProps,
  locale: 'en'
} satisfies Parameters<typeof MagicLinkEmail>[0]
