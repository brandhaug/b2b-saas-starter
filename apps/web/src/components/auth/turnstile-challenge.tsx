import { useState, type ReactNode } from 'react'
import { type AuthRequest } from '@/components/auth/auth-request'
import { TurnstileWidget } from '@/components/auth/turnstile-widget'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { type AuthResult } from '@/lib/auth-result'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * A screen's side of the Turnstile gate (ADR 0031): the widget to render and
 * the gated send. The token rides the `x-turnstile-token` header inside
 * `send`, so callers never handle it.
 *
 * The whole thing is inert without a site key — `widget` is `null` and `send`
 * calls with no token — which is what keeps every gated form working exactly
 * as it did before Turnstile existed when the provider is unconfigured
 * (provider-light rule).
 *
 * A Turnstile token is single-use, so `send` consumes it once the call
 * settles and the widget issues a fresh one for the next send.
 */
export type TurnstileChallenge = {
  /** The widget to render inside the form, or `null` when unconfigured. */
  readonly widget: ReactNode
  /** Drops the token and resets the widget, e.g. when the form starts over. */
  readonly consume: () => void
  /** One gated send; see `GatedSend`. */
  readonly send: (request: AuthRequest, gated: GatedSend) => Promise<boolean>
}

/**
 * One gated send, in the order every gated form needs it: clear the previous
 * error, refuse while the visitor owes a challenge, call with the token,
 * consume the token once the call settles (landed or not, it is spent), and
 * report a refusal through the shared auth error copy. A superseded request
 * neither consumes nor reports. `send` resolves `true` only when the call
 * landed for the current request; captcha refusals are codes in the shared
 * copy table, so they need no branch here.
 */
export type GatedSend = {
  readonly call: (turnstileToken: string | undefined) => Promise<AuthResult>
  /** Copy for a refusal the shared table does not map. */
  readonly failure: string
  /** Where the form shows its error; `null` clears it. */
  readonly report: (message: string | null) => void
  /** Copy for an unanswered challenge, when the form words it differently. */
  readonly missingMessage?: string
}

export function useTurnstileChallenge(
  siteKey: string | null | undefined
): TurnstileChallenge {
  const gate = useTurnstileGate(siteKey)

  async function send(request: AuthRequest, gated: GatedSend): Promise<boolean> {
    gated.report(null)
    if (gate.missing) {
      gated.report(gated.missingMessage ?? m.complete_bot_check())
      return false
    }
    const result = await gated.call(gate.token).finally(() => {
      if (request.current()) {
        gate.consume()
      }
    })
    if (!request.current()) {
      return false
    }
    if (result.error) {
      gated.report(authErrorCopy(result.error, gated.failure))
      return false
    }
    return true
  }

  return { widget: gate.widget, consume: gate.consume, send }
}

/** A token handed over on dispatch, or the challenge the visitor still owes. */
export type SpentTurnstileToken =
  | { readonly missing: true }
  | { readonly missing: false; readonly token: string | undefined }

/**
 * The widget and a token spent on dispatch, for a screen that answers with its
 * own outcome copy instead of `send`'s refusal copy (`OwnEmailResend`).
 * `spend` hands over the current token and resets the widget for the next
 * send; while a configured challenge is unanswered it spends nothing.
 */
export type TurnstileToken = {
  /** The widget to render, or `null` when unconfigured. */
  readonly widget: ReactNode
  readonly spend: () => SpentTurnstileToken
}

export function useTurnstileToken(siteKey: string | null | undefined): TurnstileToken {
  const gate = useTurnstileGate(siteKey)
  function spend(): SpentTurnstileToken {
    if (gate.missing) {
      return { missing: true }
    }
    gate.consume()
    return { missing: false, token: gate.token }
  }
  return { widget: gate.widget, spend }
}

function useTurnstileGate(siteKey: string | null | undefined) {
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const configured = siteKey !== null && siteKey !== undefined

  function consume(): void {
    if (!configured) {
      return
    }
    setToken(null)
    setResetKey((previous) => previous + 1)
  }

  return {
    token: token ?? undefined,
    missing: configured && token === null,
    widget: configured ? (
      <TurnstileWidget siteKey={siteKey} onToken={setToken} resetKey={resetKey} />
    ) : null,
    consume
  }
}
