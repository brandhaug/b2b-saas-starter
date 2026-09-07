import { useState, type ReactNode } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import {
  DisableFlow,
  EnableFlow,
  EnrollmentFlow,
  RegenerateFlow,
  type Enrollment
} from '@/components/auth/two-factor-flows'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * Account-level two-factor management: enable (password → one-time QR/secret
 * reveal → first code), disable (password), regenerate backup codes
 * (password). TOTP only, matching the plugin's configuration in
 * `packages/auth`.
 *
 * This module is the state machine — off → enrollment → on — and the frame
 * every step renders in; the flows themselves live beside the other auth
 * components in `auth/two-factor-flows.tsx`, each owning its own field state
 * and its own `useServerAction` (calling the Better Auth client directly).
 * Nothing is shared but the enrollment hand-off and the status line, both of
 * which cross between flows here — a single password field behind all of
 * them used to mean "Turn off" and "Regenerate" typed into each other.
 */
export function TwoFactorPanel({
  twoFactorEnabled
}: {
  // Optional/nullable to match the plugin's declared field shape; anything
  // truthy means "on".
  readonly twoFactorEnabled?: boolean | null | undefined
}) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  function clearStatus() {
    setStatusMessage(null)
  }

  if (enrollment !== null) {
    return (
      <PanelFrame heading={m.setup_authenticator()} tone="primary">
        <EnrollmentFlow
          enrollment={enrollment}
          onStart={clearStatus}
          onVerified={() => {
            setEnrollment(null)
            setStatusMessage(m.two_factor_now_on())
          }}
        />
        <StatusMessage message={statusMessage} />
      </PanelFrame>
    )
  }

  if (twoFactorEnabled) {
    return (
      <PanelFrame heading={m.status()} tone="primary">
        <p className="text-sm text-muted-foreground">
          {/* Status dot, from the status vocabulary: on = ok. */}
          <span
            className="mr-2 inline-block size-2 rounded-full bg-status-ok"
            aria-hidden="true"
          />
          {m.two_factor_on_description()}
        </p>
        <DisableFlow
          onStart={clearStatus}
          onDisabled={() => setStatusMessage(m.auth_two_factor_off())}
        />
        <RegenerateFlow onStart={clearStatus} />
        <StatusMessage message={statusMessage} />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame heading={m.turn_on()} tone="muted">
      <p className="text-sm text-muted-foreground">
        {/* Status dot: off = neutral outline, not a second gray. */}
        <span
          className="mr-2 inline-block size-2 rounded-full border border-border"
          aria-hidden="true"
        />
        {m.two_factor_off_description()}
      </p>
      <EnableFlow onStart={clearStatus} onEnrolled={setEnrollment} />
      <StatusMessage message={statusMessage} />
    </PanelFrame>
  )
}

/** The section, icon and heading every step of the panel renders inside. */
function PanelFrame({
  heading,
  tone,
  children
}: {
  readonly heading: string
  readonly tone: 'primary' | 'muted'
  readonly children: ReactNode
}) {
  return (
    <section className="grid gap-4" aria-label={m.panel_two_factor()}>
      <header className="flex items-center gap-2">
        <ShieldCheckIcon
          className={
            tone === 'primary' ? 'size-4 text-primary' : 'size-4 text-muted-foreground'
          }
        />
        <h3 className="text-sm font-semibold">{heading}</h3>
      </header>
      {children}
    </section>
  )
}

/** The status line, in an `<output>` — role `status`, per the banner pattern. */
function StatusMessage({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <output className="block rounded-none border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {message}
    </output>
  )
}
