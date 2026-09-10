import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { sixDigitCodeValidator } from '@/components/auth/auth-client-ports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { authClient } from '@/lib/auth-client'
import { authFailure } from '@/lib/auth-result'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { useServerAction } from '@/hooks/use-server-action'
import { m } from '@b2b-saas-starter/i18n/messages'

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
  onStart,
  onEnrolled
}: {
  readonly onStart: () => void
  readonly onEnrolled: (enrollment: Enrollment) => void
}) {
  const [password, setPassword] = useState('')
  const enroll = useServerAction(
    async () => {
      const result = await authClient.twoFactor.enable({ password })
      if (result.error) {
        return authFailure(authErrorCopy(result.error, m.two_factor_setup_failed()))
      }
      // oxlint-disable typescript/no-unnecessary-condition -- the plugin calls a totp-less body a success; the probe is the wire-shape honesty the type does not carry
      const totpURI =
        result.data && 'totpURI' in result.data ? (result.data.totpURI ?? null) : null
      // oxlint-enable typescript/no-unnecessary-condition
      if (totpURI === null) {
        return authFailure(m.setup_response_incomplete())
      }
      // oxlint-disable typescript/no-unnecessary-condition -- same wire-shape honesty: the otp variant of the enable answer carries neither field
      const backupCodes =
        result.data && 'backupCodes' in result.data
          ? (result.data.backupCodes ?? null)
          : null
      // oxlint-enable typescript/no-unnecessary-condition
      return { totpURI, backupCodes }
    },
    // Nothing here touches a loader, so nothing invalidates.
    {
      failureMessage: m.two_factor_setup_failed(),
      invalidate: false,
      onSuccess: onEnrolled
    }
  )

  return (
    <>
      <PasswordForm
        id="twofactor-password-on"
        label={m.form_password()}
        submitLabel={m.start_setup()}
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
  onStart,
  onVerified
}: {
  readonly enrollment: Enrollment
  readonly onStart: () => void
  readonly onVerified: () => void
}) {
  const [code, setCode] = useState('')
  // The client-side 6-digit gate never reaches the plugin, so it is the one
  // failure this component holds itself.
  const [invalidCode, setInvalidCode] = useState<string | null>(null)
  const verify = useServerAction(
    async () => {
      const result = await authClient.twoFactor.verifyTotp({ code })
      return result.error
        ? authFailure(authErrorCopy(result.error, m.auth_invalid_code()))
        : null
    },
    { failureMessage: m.auth_invalid_code(), invalidate: false, onSuccess: onVerified }
  )
  const secretFromUri = parseSecretFromUri(enrollment.totpURI)

  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <figure aria-label={m.two_factor_qr_code()}>
          <QRCodeSVG value={enrollment.totpURI} size={144} />
          <figcaption className="sr-only">{m.two_factor_qr_code()}</figcaption>
        </figure>
        <div className="grid max-w-xs gap-1">
          <p className="text-sm text-muted-foreground">{m.enter_secret_manually()}</p>
          <Identifier>{secretFromUri}</Identifier>
        </div>
      </div>
      {enrollment.backupCodes !== null && enrollment.backupCodes.length > 0 ? (
        <BackupCodesSection
          codes={enrollment.backupCodes}
          intro={m.backup_codes_save_once()}
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
          <Label htmlFor="twofactor-code">{m.form_verification_code()}</Label>
          <Input
            id="twofactor-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={m.totp_code_placeholder()}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-fit" disabled={verify.pending}>
          {m.verify_code()}
        </Button>
      </form>
      <SubmitError message={invalidCode ?? verify.error} />
    </>
  )
}

/** Turning two-factor off, behind its own password confirmation. */
export function DisableFlow({
  onStart,
  onDisabled
}: {
  readonly onStart: () => void
  readonly onDisabled: () => void
}) {
  const [password, setPassword] = useState('')
  const turnOff = useServerAction(
    async () => {
      const result = await authClient.twoFactor.disable({ password })
      return result.error
        ? authFailure(authErrorCopy(result.error, m.two_factor_disable_failed()))
        : null
    },
    {
      failureMessage: m.two_factor_disable_failed(),
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
        label={m.form_password()}
        submitLabel={m.turn_off()}
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
export function RegenerateFlow({ onStart }: { readonly onStart: () => void }) {
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<ReadonlyArray<string> | null>(null)
  const regenerate = useServerAction(
    async () => {
      const result = await authClient.twoFactor.generateBackupCodes({ password })
      if (result.error) {
        return authFailure(
          authErrorCopy(result.error, m.backup_codes_regenerate_failed())
        )
      }
      // oxlint-disable typescript/no-unnecessary-condition -- regeneration can answer a body without the codes; the probe and the refusal below are that wire-shape honesty
      const backupCodes = result.data?.backupCodes ?? null
      if (backupCodes === null || backupCodes.length === 0) {
        return authFailure(m.regeneration_response_incomplete())
      }
      // oxlint-enable typescript/no-unnecessary-condition
      return backupCodes
    },
    {
      failureMessage: m.backup_codes_regenerate_failed(),
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
        label={m.form_confirm_password()}
        submitLabel={m.regenerate_backup_codes()}
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
      aria-label={m.backup_codes()}
      className="grid gap-2 rounded-sm border border-border bg-muted/40 p-4"
    >
      <p className="text-sm font-medium">{intro ?? m.backup_codes_save_all_once()}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {codes.map((backupCode) => (
          <li key={backupCode}>
            <code className="font-mono text-xs">{backupCode}</code>
          </li>
        ))}
      </ul>
      {onDismiss ? (
        <Button type="button" variant="outline" className="w-fit" onClick={onDismiss}>
          {m.saved_my_codes()}
        </Button>
      ) : null}
    </section>
  )
}
