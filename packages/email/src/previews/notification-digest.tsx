import { NotificationDigestEmail } from '../notification-templates.tsx'

export default function Preview(props: Parameters<typeof NotificationDigestEmail>[0]) {
  return <NotificationDigestEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...NotificationDigestEmail.PreviewProps,
  recipientName: 'Anne-Sofie Østergård-Hansen',
  locale: 'nb',
  items: [
    {
      id: 'not_preview_nb',
      kindLabel: 'Kunngjøringer',
      title: 'Eksempel på en stor faktura',
      message: 'Eksempelbeløp: 9 999 999,99 kr. Ingen betaling er gjennomført.',
      workspaceName: null,
      createdAt: '1. november 2026 kl. 08:30 CET'
    }
  ]
} satisfies Parameters<typeof NotificationDigestEmail>[0]
