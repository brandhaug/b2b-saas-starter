import { OneTimeCodeEmail } from '../templates.tsx'

export default function Preview() {
  return <OneTimeCodeEmail code="123456" purpose="forget-password" />
}
