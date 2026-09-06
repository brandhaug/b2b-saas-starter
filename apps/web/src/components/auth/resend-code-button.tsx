import { Button } from '@/components/ui/button'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The resend control shared by every one-time-code surface (code sign-in,
 * code verification, code reset): disabled while the visible cooldown runs,
 * with the remaining seconds in the label so the wait is legible.
 */
export function ResendCodeButton({
  cooldownSeconds,
  onResend
}: {
  readonly cooldownSeconds: number
  readonly onResend: () => Promise<void>
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={cooldownSeconds > 0}
      onClick={() => {
        void onResend()
      }}
    >
      {cooldownSeconds > 0
        ? m.resend_code_in_seconds({ count: cooldownSeconds })
        : m.resend_code()}
    </Button>
  )
}
