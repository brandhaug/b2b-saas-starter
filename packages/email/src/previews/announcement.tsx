import { AnnouncementEmail } from '../notification-templates.tsx'

export default function Preview() {
  return <AnnouncementEmail {...AnnouncementEmail.PreviewProps} />
}
