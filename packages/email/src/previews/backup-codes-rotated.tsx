import { BackupCodesRotatedEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof BackupCodesRotatedEmail>[0]) {
  return <BackupCodesRotatedEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = { locale: 'en' } satisfies Parameters<
  typeof BackupCodesRotatedEmail
>[0]
