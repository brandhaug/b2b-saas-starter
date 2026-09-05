import { useState, type ReactNode } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import {
  disableTwoFactorWithAuthClient,
  enableTwoFactorWithAuthClient,
  generateBackupCodesWithAuthClient,
  verifyTotpWithAuthClient,
  type DisableTwoFactor,
  type EnableTwoFactor,
  type GenerateBackupCodes,
  type VerifyTotpCode
} from '@/components/auth/auth-client-ports'
import {
  DisableFlow,
  EnableFlow,
  EnrollmentFlow,
  RegenerateFlow,
  type Enrollment
} from '@/components/auth/two-factor-flows'

export type {
  DisableTwoFactor,
  EnableTwoFactor,
  GenerateBackupCodes
} from '@/components/auth/auth-client-ports'

/**
 * Account-level two-factor management: enable (password → one-time QR/secret
 * reveal → first code), disable (password), regenerate backup codes
 * (password). TOTP only, matching the plugin's configuration in
 * `packages/auth`.
 *
 * This module is the state machine — off → enrollment → on — and the frame
 * every step renders in; the flows themselves live beside the other auth
 * components in `auth/two-factor-flows.tsx`, each owning its own field state
 * and its own `useServerAction`. Nothing is shared but the enrollment
 * hand-off and the status line, both of which cross between flows here — a
 * single password field behind all of them used to mean "Turn off" and
 * "Regenerate" typed into each other.
 */
export function TwoFactorPanel({
  twoFactorEnabled,
  enableTwoFactor = enableTwoFactorWithAuthClient,
  verifyTotp = verifyTotpWithAuthClient,
  disableTwoFactor = disableTwoFactorWithAuthClient,
  generateBackupCodes = generateBackupCodesWithAuthClient
}: {
  // Optional/nullable to match the plugin's declared field shape; anything
  // truthy means "on".
  readonly twoFactorEnabled?: boolean | null | undefined
  readonly enableTwoFactor?: EnableTwoFactor
  readonly verifyTotp?: VerifyTotpCode
  readonly disableTwoFactor?: DisableTwoFactor
  readonly generateBackupCodes?: GenerateBackupCodes
}) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  function clearStatus() {
    setStatusMessage(null)
  }

  if (enrollment !== null) {
    return (
      <PanelFrame heading="Set up your authenticator" tone="primary">
        <EnrollmentFlow
          enrollment={enrollment}
          verifyTotp={verifyTotp}
          onStart={clearStatus}
          onVerified={() => {
            setEnrollment(null)
            setStatusMessage('Two-factor authentication is now on.')
          }}
        />
        <StatusMessage message={statusMessage} />
      </PanelFrame>
    )
  }

  if (twoFactorEnabled) {
    return (
      <PanelFrame heading="Status" tone="primary">
        <p className="text-sm text-muted-foreground">
          {/* Status dot, from the status vocabulary: on = ok. */}
          <span
            className="mr-2 inline-block size-2 rounded-full bg-status-ok"
            aria-hidden
          />
          On. Codes are required at sign-in.
        </p>
        <DisableFlow
          disableTwoFactor={disableTwoFactor}
          onStart={clearStatus}
          onDisabled={() => setStatusMessage('Two-factor authentication is now off.')}
        />
        <RegenerateFlow
          generateBackupCodes={generateBackupCodes}
          onStart={clearStatus}
        />
        <StatusMessage message={statusMessage} />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame heading="Turn on" tone="muted">
      <p className="text-sm text-muted-foreground">
        {/* Status dot: off = neutral outline, not a second gray. */}
        <span
          className="mr-2 inline-block size-2 rounded-full border border-border"
          aria-hidden
        />
        Off. Add an authenticator-app code to sign-in.
      </p>
      <EnableFlow
        enableTwoFactor={enableTwoFactor}
        onStart={clearStatus}
        onEnrolled={setEnrollment}
      />
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
    <section className="grid gap-4" aria-label="Two-factor authentication">
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
