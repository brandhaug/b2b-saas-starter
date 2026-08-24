import { QRCodeSVG } from 'qrcode.react'
import { useReducer, useState } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
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
  // ('otp' | 'totp'); only the 'totp' variant carries `totpURI`.
  readonly data?:
    | { readonly totpURI?: string | undefined }
    | { readonly method?: string }
    | null
    | undefined
  readonly error?: { readonly message?: string | undefined } | null
}>

export type VerifyTotp = (input: { readonly code: string }) => Promise<{
  readonly data?: unknown
  readonly error?: { readonly message?: string | undefined } | null
}>

export type DisableTwoFactor = (input: { readonly password: string }) => Promise<{
  readonly data?: unknown
  readonly error?: { readonly message?: string | undefined } | null
}>

function enableWithAuthClient(input: Parameters<EnableTwoFactor>[0]) {
  return authClient.twoFactor.enable(input)
}

function verifyTotpWithAuthClient(input: Parameters<VerifyTotp>[0]) {
  return authClient.twoFactor.verifyTotp({ code: input.code })
}

function disableWithAuthClient(input: Parameters<DisableTwoFactor>[0]) {
  return authClient.twoFactor.disable(input)
}

type PanelState = {
  /** 'idle' → 'enrolling' (one-time QR reveal) → idle with the enabled flag. */
  readonly step: 'idle' | 'enrolling'
  readonly totpURI: string | null
  readonly password: string
  readonly code: string
  readonly submitError: string | null
  readonly statusMessage: string | null
}

type PanelAction =
  | { readonly type: 'password'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'enrolled'; readonly totpURI: string }
  | { readonly type: 'verified' }
  | { readonly type: 'disabled' }
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
      // The one-time reveal starts here; the secret lives in the URI.
      return { ...state, step: 'enrolling', totpURI: action.totpURI }
    }
    case 'verified': {
      return {
        ...state,
        step: 'idle',
        totpURI: null,
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
  disableTwoFactor = disableWithAuthClient
}: {
  // Optional/nullable to match the plugin's declared field shape; anything
  // truthy means "on".
  readonly twoFactorEnabled?: boolean | null | undefined
  readonly enableTwoFactor?: EnableTwoFactor
  readonly verifyTotp?: VerifyTotp
  readonly disableTwoFactor?: DisableTwoFactor
}) {
  const [state, dispatch] = useReducer(reducer, {
    step: 'idle',
    totpURI: null,
    password: '',
    code: '',
    submitError: null,
    statusMessage: null
  })
  const [busy, setBusy] = useState(false)

  async function startSetup() {
    dispatch({ type: 'clearStatus' })
    setBusy(true)
    const result = await enableTwoFactor({ password: state.password }).finally(() =>
      setBusy(false)
    )
    if (result.error) {
      dispatch({
        type: 'failed',
        message: result.error.message ?? 'Could not start setup'
      })
      return
    }
    const data = result.data
    if (!data || !('totpURI' in data) || !data.totpURI) {
      dispatch({ type: 'failed', message: 'Setup response was incomplete' })
      return
    }
    dispatch({ type: 'enrolled', totpURI: data.totpURI })
  }

  async function confirmCode() {
    dispatch({ type: 'clearStatus' })
    setBusy(true)
    const result = await verifyTotp({ code: state.code }).finally(() => setBusy(false))
    if (result.error) {
      dispatch({
        type: 'failed',
        message: result.error.message ?? 'Invalid code'
      })
      return
    }
    dispatch({ type: 'verified' })
  }

  async function turnOff() {
    dispatch({ type: 'clearStatus' })
    setBusy(true)
    const result = await disableTwoFactor({ password: state.password }).finally(() =>
      setBusy(false)
    )
    if (result.error) {
      dispatch({
        type: 'failed',
        message: result.error.message ?? 'Could not turn off two-factor'
      })
      return
    }
    dispatch({ type: 'disabled' })
  }

  const secretFromUri = state.totpURI?.split('secret=')[1]?.split('&')[0] ?? null

  if (twoFactorEnabled && state.step === 'idle') {
    return (
      <section className="grid gap-4" aria-label="Two-factor authentication">
        <header className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" />
          <h3 className="text-sm font-medium">Two-factor authentication</h3>
        </header>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-primary" aria-hidden />
          On. Codes are required at sign-in.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void turnOff()
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
            Neither is shown again after this. */}
        <div className="flex flex-wrap items-start gap-6">
          <figure aria-label="Two-factor secret QR code">
            <QRCodeSVG value={state.totpURI} size={144} />
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
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void confirmCode()
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
        <h3 className="text-sm font-medium">Two-factor authentication</h3>
      </header>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-border" aria-hidden />
        Off. Add an authenticator-app code to sign-in.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void startSetup()
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
