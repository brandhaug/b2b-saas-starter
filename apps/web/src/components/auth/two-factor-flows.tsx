import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import {
  sixDigitCodeValidator,
  type DisableTwoFactor,
  type EnableTwoFactor,
  type GenerateBackupCodes,
  type VerifyTotpCode
} from '@/components/auth/auth-client-ports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { authFailure } from '@/lib/auth-result'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { useServerAction } from '@/hooks/use-server-action'

/**
 * The two-factor panel's flows, extracted from
 * `components/two-factor-panel.tsx` so the panel reads as the state machine
 * it is (off → enrollment → on) and each flow stays independently readable.
 * Each flow owns its own field state and its own `useServerAction`; nothing
 * is shared but the enrollment hand-off, which crosses through the panel.
 *
 * Failure copy comes from the shared code table
 * (`lib/auth-error-copy.ts`): the call site's constant is the fallback for
 * uncoded failures, never the rendered message itself.
 */

const ENROLL_FAILED = 'Could not start setup'
const VERIFY_FAILED = 'Invalid code'
const DISABLE_FAILED = 'Could not turn off two-factor'
const REGENERATE_FAILED = 'Could not regenerate backup codes'

/** The one-time reveal handed over when enrollment starts. */
export type Enrollment = {
  readonly totpURI: string
  readonly backupCodes: ReadonlyArray<string> | null
}

/** Reads the `secret` query parameter off a TOTP URI; an unparseable URI or
 * one without a secret yields null rather than a mangled substring. */
function parseSecretFromUri(uri: string): string | null {
  if (!URL.canParse(uri)) {
    return null
  }
  return new URL(uri).searchParams.get('secret')
}

/**
 * Step one: a password confirmation buys the one-time QR/secret reveal. A
 * response the plugin calls a success but that came back without a TOTP URI
 * rejects like any other failure.
 */
export function EnableFlow({
  enableTwoFactor,
  onStart,
  onEnrolled
}: {
  readonly enableTwoFactor: EnableTwoFactor
  readonly onStart: () => void
  readonly onEnrolled: (enrollment: Enrollment) => void
}) {
  const [password, setPassword] = useState('')
  const enroll = useServerAction(
    async () => {
      const result = await enableTwoFactor({ password })
      if (result.error) {
        return authFailure(authErrorCopy(result.error, ENROLL_FAILED))
      }
      const totpURI =
        result.data && 'totpURI' in result.data ? (result.data.totpURI ?? null) : null
      if (totpURI === null) {
        return authFailure('Setup response was incomplete')
      }
      const backupCodes =
        result.data && 'backupCodes' in result.data
          ? (result.data.backupCodes ?? null)
          : null
      return { totpURI, backupCodes }
    },
    // Nothing here touches a loader, so nothing invalidates.
    { failureMessage: ENROLL_FAILED, invalidate: false, onSuccess: onEnrolled }
  )

  return (
    <>
      <PasswordForm
        id="twofactor-password-on"
        label="Password"
        submitLabel="Start setup"
        value={password}
        busy={enroll.pending}
        onChange={setPassword}
        onSubmit={() => {
          onStart()
          enroll.run()
        }}
      />
      <SubmitError message={enroll.error} />
    </>
  )
}

/**
 * Step two, the one-time reveal: scan the QR — or type the secret into an
 * authenticator that cannot scan — then confirm with a first code. Neither is
 * shown again after this, and neither are the backup codes.
 */
export function EnrollmentFlow({
  enrollment,
  verifyTotp,
  onStart,
  onVerified
}: {
  readonly enrollment: Enrollment
  readonly verifyTotp: VerifyTotpCode
  readonly onStart: () => void
  readonly onVerified: () => void
}) {
  const [code, setCode] = useState('')
  // The client-side 6-digit gate never reaches the plugin, so it is the one
  // failure this component holds itself.
  const [invalidCode, setInvalidCode] = useState<string | null>(null)
  const verify = useServerAction(
    async () => {
      const result = await verifyTotp({ code })
      return result.error
        ? authFailure(authErrorCopy(result.error, VERIFY_FAILED))
        : null
    },
    { failureMessage: VERIFY_FAILED, invalidate: false, onSuccess: onVerified }
  )
  const secretFromUri = parseSecretFromUri(enrollment.totpURI)

  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <figure aria-label="Two-factor secret QR code">
          <QRCodeSVG value={enrollment.totpURI} size={144} />
          <figcaption className="sr-only">Two-factor secret QR code</figcaption>
        </figure>
        <div className="grid max-w-xs gap-1">
          <p className="text-sm text-muted-foreground">
            Or enter this secret manually:
          </p>
          <Identifier>{secretFromUri}</Identifier>
        </div>
      </div>
      {enrollment.backupCodes !== null && enrollment.backupCodes.length > 0 ? (
        <BackupCodesSection
          codes={enrollment.backupCodes}
          intro="Save these one-time backup codes now. They are shown only once:"
        />
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onStart()
          // Same 6-digit gate as the sign-in challenge page — the shared validator.
          const message = sixDigitCodeValidator({ value: code })
          setInvalidCode(message ?? null)
          if (message === undefined) {
            verify.run()
          }
        }}
        className="grid gap-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="twofactor-code">Verification code</Label>
          <Input
            id="twofactor-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-fit" disabled={verify.pending}>
          Verify code
        </Button>
      </form>
      <SubmitError message={invalidCode ?? verify.error} />
    </>
  )
}

/** Turning two-factor off, behind its own password confirmation. */
export function DisableFlow({
  disableTwoFactor,
  onStart,
  onDisabled
}: {
  readonly disableTwoFactor: DisableTwoFactor
  readonly onStart: () => void
  readonly onDisabled: () => void
}) {
  const [password, setPassword] = useState('')
  const turnOff = useServerAction(
    async () => {
      const result = await disableTwoFactor({ password })
      return result.error
        ? authFailure(authErrorCopy(result.error, DISABLE_FAILED))
        : null
    },
    {
      failureMessage: DISABLE_FAILED,
      invalidate: false,
      onSuccess: () => {
        setPassword('')
        onDisabled()
      }
    }
  )

  return (
    <>
      <PasswordForm
        id="twofactor-password-off"
        label="Password"
        submitLabel="Turn off"
        variant="outline"
        value={password}
        busy={turnOff.pending}
        onChange={setPassword}
        onSubmit={() => {
          onStart()
          turnOff.run()
        }}
      />
      <SubmitError message={turnOff.error} />
    </>
  )
}

/**
 * Regenerating the backup codes. New codes invalidate every previous one, so
 * they get the same one-time reveal as enrollment — until the user says they
 * saved them. Its password is its own: turn-off should not trust what was
 * typed here, and vice versa.
 */
export function RegenerateFlow({
  generateBackupCodes,
  onStart
}: {
  readonly generateBackupCodes: GenerateBackupCodes
  readonly onStart: () => void
}) {
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<ReadonlyArray<string> | null>(null)
  const regenerate = useServerAction(
    async () => {
      const result = await generateBackupCodes({ password })
      if (result.error) {
        return authFailure(authErrorCopy(result.error, REGENERATE_FAILED))
      }
      const backupCodes = result.data?.backupCodes ?? null
      if (backupCodes === null || backupCodes.length === 0) {
        return authFailure('Regeneration response was incomplete')
      }
      return backupCodes
    },
    {
      failureMessage: REGENERATE_FAILED,
      invalidate: false,
      onSuccess: (backupCodes: ReadonlyArray<string>) => {
        setPassword('')
        setCodes(backupCodes)
      }
    }
  )

  return (
    <>
      {codes === null ? null : (
        <BackupCodesSection codes={codes} onDismiss={() => setCodes(null)} />
      )}
      <PasswordForm
        id="twofactor-password-regen"
        label="Confirm password"
        submitLabel="Regenerate backup codes"
        variant="outline"
        value={password}
        busy={regenerate.pending}
        onChange={setPassword}
        onSubmit={() => {
          onStart()
          regenerate.run()
        }}
      />
      <SubmitError message={regenerate.error} />
    </>
  )
}

/** The password-confirmation form the three password-gated flows all render. */
function PasswordForm({
  id,
  label,
  submitLabel,
  variant,
  value,
  busy,
  onChange,
  onSubmit
}: {
  readonly id: string
  readonly label: string
  readonly submitLabel: string
  readonly variant?: 'outline'
  readonly value: string
  readonly busy: boolean
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="grid gap-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      </div>
      <Button
        type="submit"
        {...(variant === undefined ? {} : { variant })}
        className="w-fit"
        disabled={busy}
      >
        {submitLabel}
      </Button>
    </form>
  )
}

function SubmitError({ message }: { readonly message: string | null }) {
  return <ActionFeedback error={message} />
}

/**
 * The one-time backup-code reveal, shared by enrollment and regeneration.
 * `onDismiss` (the "I saved my codes" button) is only offered where the codes
 * can come back — regeneration — so the enrollment reveal keeps its hard
 * once-only shape.
 */
function BackupCodesSection({
  codes,
  intro,
  onDismiss
}: {
  readonly codes: ReadonlyArray<string>
  readonly intro?: string
  readonly onDismiss?: () => void
}) {
  return (
    <section
      aria-label="Backup codes"
      className="grid gap-2 rounded-sm border border-border bg-muted/40 p-4"
    >
      <p className="text-sm font-medium">
        {intro ??
          'Save these one-time backup codes now. They are shown only once, and every previous code is now invalid:'}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {codes.map((backupCode) => (
          <li key={backupCode}>
            <code className="font-mono text-xs">{backupCode}</code>
          </li>
        ))}
      </ul>
      {onDismiss ? (
        <Button type="button" variant="outline" className="w-fit" onClick={onDismiss}>
          I saved my codes
        </Button>
      ) : null}
    </section>
  )
}
