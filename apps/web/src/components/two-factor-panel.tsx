import { QRCodeSVG } from 'qrcode.react'
import { useReducer, useState } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import {
  sixDigitCodeValidator,
  verifyTotpWithAuthClient,
  type VerifyTotpCode
} from '@/components/auth/auth-client-ports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The three Better Auth twoFactor endpoints this panel drives, as ports.
 * Injected rather than reaching for the `authClient` singleton at the call
 * site so a test drives the panel with real functions of these shapes instead
 * of replacing `@/lib/auth-client`.
 */
export type EnableTwoFactor = (input: { readonly password: string }) => Promise<{
  // Better Auth's enable response is a discriminated union on `method`
  // ('otp' | 'totp'); only the 'totp' variant carries `totpURI`, and the
  // plugin generates one-time backup codes alongside it.
  readonly data?:
    | {
        readonly totpURI?: string | undefined
        readonly backupCodes?: Array<string> | undefined
      }
    | { readonly method?: string }
    | null
    | undefined
  readonly error?: { readonly message?: string | undefined } | null
}>

export type DisableTwoFactor = (input: { readonly password: string }) => Promise<{
  readonly data?: unknown
  readonly error?: { readonly message?: string | undefined } | null
}>

export type GenerateBackupCodes = (input: { readonly password: string }) => Promise<{
  readonly data?:
    | { readonly backupCodes?: Array<string> | undefined }
    | null
    | undefined
  readonly error?: { readonly message?: string | undefined } | null
}>

function enableWithAuthClient(input: Parameters<EnableTwoFactor>[0]) {
  return authClient.twoFactor.enable(input)
}

function disableWithAuthClient(input: Parameters<DisableTwoFactor>[0]) {
  return authClient.twoFactor.disable(input)
}

function generateBackupCodesWithAuthClient(input: Parameters<GenerateBackupCodes>[0]) {
  return authClient.twoFactor.generateBackupCodes(input)
}

type PanelState = {
  /** 'idle' → 'enrolling' (one-time QR reveal) → idle with the enabled flag. */
  readonly step: 'idle' | 'enrolling'
  readonly totpURI: string | null
  readonly backupCodes: ReadonlyArray<string> | null
  readonly password: string
  readonly code: string
  readonly submitError: string | null
  readonly statusMessage: string | null
}

/** Reads the `secret` query parameter off a TOTP URI; an unparseable URI or
 * one without a secret yields null rather than a mangled substring. */
function parseSecretFromUri(uri: string | null): string | null {
  if (uri === null || !URL.canParse(uri)) {
    return null
  }
  return new URL(uri).searchParams.get('secret')
}

type PanelAction =
  | { readonly type: 'password'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | {
      readonly type: 'enrolled'
      readonly totpURI: string
      readonly backupCodes: ReadonlyArray<string> | null
    }
  | { readonly type: 'verified' }
  | { readonly type: 'disabled' }
  | { readonly type: 'regenerated'; readonly backupCodes: ReadonlyArray<string> }
  | { readonly type: 'dismissCodes' }
  | { readonly type: 'failed'; readonly message: string }
  | { readonly type: 'clearStatus' }

function reducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'password': {
      return { ...state, password: action.value }
    }
    case 'code': {
      return { ...state, code: action.value }
    }
    case 'enrolled': {
      // The one-time reveal starts here; the secret lives in the URI and the
      // backup codes ride the same response.
      return {
        ...state,
        step: 'enrolling',
        totpURI: action.totpURI,
        backupCodes: action.backupCodes
      }
    }
    case 'verified': {
      return {
        ...state,
        step: 'idle',
        totpURI: null,
        backupCodes: null,
        code: '',
        password: '',
        statusMessage: 'Two-factor authentication is now on.'
      }
    }
    case 'disabled': {
      return {
        ...state,
        password: '',
        statusMessage: 'Two-factor authentication is now off.'
      }
    }
    case 'regenerated': {
      // New codes invalidate every previous one; they get the same one-time
      // reveal as enrollment, until the user dismisses them.
      return {
        ...state,
        password: '',
        backupCodes: action.backupCodes,
        statusMessage: null
      }
    }
    case 'dismissCodes': {
      return { ...state, backupCodes: null }
    }
    case 'failed': {
      return { ...state, submitError: action.message }
    }
    case 'clearStatus': {
      return { ...state, submitError: null, statusMessage: null }
    }
  }
}

/**
 * Account-level two-factor management: enable (password → one-time QR/secret
 * reveal → first code), disable (password). TOTP only, matching the plugin's
 * configuration in `packages/auth`.
 */
export function TwoFactorPanel({
  twoFactorEnabled,
  enableTwoFactor = enableWithAuthClient,
  verifyTotp = verifyTotpWithAuthClient,
  disableTwoFactor = disableWithAuthClient,
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
  const [state, dispatch] = useReducer(reducer, {
    step: 'idle',
    totpURI: null,
    backupCodes: null,
    password: '',
    code: '',
    submitError: null,
    statusMessage: null
  })
  const [busy, setBusy] = useState(false)

  /**
   * The one action shape all three flows share: clear the status line, run the
   * endpoint with the busy flag up, fold a plugin failure into `failed`, and
   * hand the success result to the caller.
   */
  async function runAction<
    A extends { readonly error?: { readonly message?: string | undefined } | null }
  >(run: () => Promise<A>, fallbackMessage: string, onSuccess: (result: A) => void) {
    dispatch({ type: 'clearStatus' })
    setBusy(true)
    const result = await run().finally(() => setBusy(false))
    if (result.error) {
      dispatch({
        type: 'failed',
        message: result.error.message ?? fallbackMessage
      })
      return
    }
    onSuccess(result)
  }

  /** Wraps `enableTwoFactor` so an incomplete response is a failure too. */
  async function beginEnrollment(): Promise<
    | { readonly error: { readonly message: string } }
    | {
        readonly error?: { readonly message?: string | undefined } | null
        readonly totpURI: string | null
        readonly backupCodes: ReadonlyArray<string> | null
      }
  > {
    const result = await enableTwoFactor({ password: state.password })
    const totpURI =
      result.data && 'totpURI' in result.data ? (result.data.totpURI ?? null) : null
    const backupCodes =
      result.data && 'backupCodes' in result.data
        ? (result.data.backupCodes ?? null)
        : null
    if (!result.error && totpURI === null) {
      return { error: { message: 'Setup response was incomplete' } }
    }
    return { totpURI, backupCodes }
  }

  function startSetup() {
    void runAction(beginEnrollment, 'Could not start setup', (result) => {
      if (!('totpURI' in result) || result.totpURI === null) {
        return
      }
      dispatch({
        type: 'enrolled',
        totpURI: result.totpURI,
        backupCodes: result.backupCodes
      })
    })
  }

  function confirmCode() {
    // Same 6-digit gate as the sign-in challenge page — the shared validator.
    const invalidCode = sixDigitCodeValidator({ value: state.code })
    if (invalidCode !== undefined) {
      dispatch({ type: 'failed', message: invalidCode })
      return
    }
    void runAction(
      () => verifyTotp({ code: state.code }),
      'Invalid code',
      () => dispatch({ type: 'verified' })
    )
  }

  function turnOff() {
    void runAction(
      () => disableTwoFactor({ password: state.password }),
      'Could not turn off two-factor',
      () => dispatch({ type: 'disabled' })
    )
  }

  function regenerateCodes() {
    void runAction(
      async () => {
        const result = await generateBackupCodes({ password: state.password })
        const backupCodes =
          result.data && !result.error ? (result.data.backupCodes ?? null) : null
        if (!result.error && (backupCodes === null || backupCodes.length === 0)) {
          return {
            error: { message: 'Regeneration response was incomplete' }
          }
        }
        return { ...result, backupCodes }
      },
      'Could not regenerate backup codes',
      (result) => {
        if (!('backupCodes' in result) || result.backupCodes === null) {
          return
        }
        dispatch({ type: 'regenerated', backupCodes: result.backupCodes })
      }
    )
  }

  // The secret lives in the URI's query string; an unparseable URI yields no
  // secret rather than a mangled substring.
  const secretFromUri = parseSecretFromUri(state.totpURI)

  if (twoFactorEnabled && state.step === 'idle') {
    return (
      <section className="grid gap-4" aria-label="Two-factor authentication">
        <header className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" />
          <h3 className="text-sm font-medium">Status</h3>
        </header>
        <p className="text-sm text-muted-foreground">
          <span
            className="mr-2 inline-block size-2 rounded-full bg-muted-foreground"
            aria-hidden
          />
          On. Codes are required at sign-in.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            turnOff()
          }}
          className="grid gap-3"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="twofactor-password-off">Password</Label>
            <Input
              id="twofactor-password-off"
              type="password"
              autoComplete="current-password"
              value={state.password}
              onChange={(event) =>
                dispatch({ type: 'password', value: event.target.value })
              }
              required
            />
          </div>
          <Button type="submit" variant="outline" className="w-fit" disabled={busy}>
            Turn off
          </Button>
        </form>
        {state.backupCodes !== null && state.backupCodes.length > 0 ? (
          <BackupCodesSection
            codes={state.backupCodes}
            onDismiss={() => dispatch({ type: 'dismissCodes' })}
          />
        ) : null}
        <RegenerateBackupCodesForm
          password={state.password}
          busy={busy}
          onPasswordChange={(value) => dispatch({ type: 'password', value })}
          onSubmit={regenerateCodes}
        />
        <PanelMessages state={state} />
      </section>
    )
  }

  if (state.step === 'enrolling' && state.totpURI !== null) {
    return (
      <section className="grid gap-4" aria-label="Two-factor authentication">
        <header className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" />
          <h3 className="text-sm font-medium">Set up your authenticator</h3>
        </header>
        {/* The one-time reveal: scan the QR — or type the secret into an
            authenticator that cannot scan — then confirm with a first code.
            Neither is shown again after this, and neither are the backup
            codes below. */}
        <div className="flex flex-wrap items-start gap-6">
          <figure aria-label="Two-factor secret QR code">
            <QRCodeSVG value={state.totpURI} size={144} />
            <figcaption className="sr-only">Two-factor secret QR code</figcaption>
          </figure>
          <div className="grid max-w-xs gap-1">
            <p className="text-sm text-muted-foreground">
              Or enter this secret manually:
            </p>
            <code className="break-all rounded-sm bg-muted px-2 py-1 font-mono text-xs">
              {secretFromUri}
            </code>
          </div>
        </div>
        {state.backupCodes !== null && state.backupCodes.length > 0 ? (
          <BackupCodesSection
            codes={state.backupCodes}
            intro="Save these one-time backup codes now. They are shown only once:"
          />
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            confirmCode()
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
              value={state.code}
              onChange={(event) =>
                dispatch({ type: 'code', value: event.target.value })
              }
              required
            />
          </div>
          <Button type="submit" className="w-fit" disabled={busy}>
            Verify code
          </Button>
        </form>
        <PanelMessages state={state} />
      </section>
    )
  }

  return (
    <section className="grid gap-4" aria-label="Two-factor authentication">
      <header className="flex items-center gap-2">
        <ShieldCheckIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Turn on</h3>
      </header>
      <p className="text-sm text-muted-foreground">
        <span className="mr-2 inline-block size-2 rounded-full bg-border" aria-hidden />
        Off. Add an authenticator-app code to sign-in.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          startSetup()
        }}
        className="grid gap-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="twofactor-password-on">Password</Label>
          <Input
            id="twofactor-password-on"
            type="password"
            autoComplete="current-password"
            value={state.password}
            onChange={(event) =>
              dispatch({ type: 'password', value: event.target.value })
            }
            required
          />
        </div>
        <Button type="submit" className="w-fit" disabled={busy}>
          Start setup
        </Button>
      </form>
      <PanelMessages state={state} />
    </section>
  )
}

/** Status and error live in `<output>`/alert roles, per the banner pattern. */
function PanelMessages({ state }: { readonly state: PanelState }) {
  return (
    <>
      {state.statusMessage ? (
        <output className="block rounded-none border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {state.statusMessage}
        </output>
      ) : null}
      {state.submitError ? (
        <p role="alert" className="text-xs text-destructive">
          {state.submitError}
        </p>
      ) : null}
    </>
  )
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

/**
 * The regeneration form: a fresh password confirmation feeding the same
 * shared password state as turn-off. Neither action should trust the other's
 * input; the distinct label keeps the two fields addressable while one value
 * feeds both.
 */
function RegenerateBackupCodesForm({
  password,
  busy,
  onPasswordChange,
  onSubmit
}: {
  readonly password: string
  readonly busy: boolean
  readonly onPasswordChange: (value: string) => void
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
        <Label htmlFor="twofactor-password-regen">Confirm password</Label>
        <Input
          id="twofactor-password-regen"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          required
        />
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={busy}>
        Regenerate backup codes
      </Button>
    </form>
  )
}
