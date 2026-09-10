import { useState, type ReactNode } from 'react'
import { TurnstileWidget } from '@/components/auth/turnstile-widget'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * A screen's side of the Turnstile gate (ADR 0031), in one piece: the widget
 * to render, the token to ride the `x-turnstile-token` header, whether the
 * visitor still owes a challenge, and the single-use reset after a send.
 *
 * The whole thing is inert without a site key — `widget` is `null`, `token` is
 * `undefined`, `missing` is `false` — which is what keeps every gated form
 * working exactly as it did before Turnstile existed when the provider is
 * unconfigured (provider-light rule).
 *
 * Screens that send more than once (a code resend, the reset page's two asks)
 * call `consume()` after each send: a Turnstile token is single-use, so the
 * widget has to issue a fresh one for the next.
 */
export type TurnstileChallenge = {
  /** The current token, or `undefined` when there is nothing to send. */
  readonly token: string | undefined
  /** A configured challenge the visitor has not answered yet. */
  readonly missing: boolean
  /** The sentence to show when `missing` blocks a submit. */
  readonly missingMessage: string
  /** The widget to render inside the form, or `null` when unconfigured. */
  readonly widget: ReactNode
  /** Drops the spent token and asks the widget for a fresh challenge. */
  readonly consume: () => void
}

export function useTurnstileChallenge(
  siteKey: string | null | undefined
): TurnstileChallenge {
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const configured = siteKey !== null && siteKey !== undefined
  return {
    token: token ?? undefined,
    missing: configured && token === null,
    missingMessage: m.complete_bot_check(),
    widget: configured ? (
      <TurnstileWidget siteKey={siteKey} onToken={setToken} resetKey={resetKey} />
    ) : null,
    consume: () => {
      if (!configured) {
        return
      }
      setToken(null)
      setResetKey((previous) => previous + 1)
    }
  }
}
