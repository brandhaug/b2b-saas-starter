import { Button } from '@/components/ui/button'

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
      size="sm"
      disabled={cooldownSeconds > 0}
      onClick={() => {
        void onResend()
      }}
    >
      {cooldownSeconds > 0 ? `Resend code (${cooldownSeconds}s)` : 'Resend code'}
    </Button>
  )
}
