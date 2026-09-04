import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { FingerprintIcon } from 'lucide-react'
import {
  signInPasskeyWithAuthClient,
  type SignInWithPasskey
} from '@/components/auth/auth-client-ports'
import { Button } from '@/components/ui/button'
import { authFailure } from '@/lib/auth-result'
import { useServerAction } from '@/hooks/use-server-action'
import { conditionalMediationAvailable } from '@/lib/webauthn-support'
import { oauthContinuationUrl } from '@/lib/oauth-continuation'
import { safeRedirect } from '@/lib/utils'

const PASSKEY_FAILED = 'Passkey sign-in failed'

/**
 * The passkey sign-in block on the sign-in page: the button, its action, and
 * the conditional-UI preload. Same destination as the password form, different
 * credential — a success carries the session (passkey sign-in needs no
 * two-factor hop, the ceremony already proved two factors, ADR 0056); a
 * cancellation or failure lands as this block's own message, never as a
 * password failure. Extracted from the page so the credential form and this
 * alternative credential stay independently readable.
 */
export function PasskeySignIn({
  redirect,
  signInPasskey = signInPasskeyWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly signInPasskey?: SignInWithPasskey | undefined
}) {
  const router = useRouter()

  const passkeySignIn = useServerAction(
    async (input: { readonly autoFill?: boolean } | undefined) => {
      const result = await signInPasskey(input)
      if (result.error) {
        return authFailure(result.error.message ?? PASSKEY_FAILED)
      }
      if (result.data !== null && result.data !== undefined) {
        // A sign-in an MCP client started resumes the authorization first:
        // `oauthProviderClient` attaches the signed OAuth query to this call
        // too, so the provider answers with the next hop — the same
        // continuation the password path takes.
        const continuation = oauthContinuationUrl(result.data)
        if (continuation !== null) {
          window.location.assign(continuation)
          return
        }
        router.history.push(safeRedirect(redirect))
      }
    },
    { failureMessage: PASSKEY_FAILED, invalidate: false }
  )

  // Conditional UI: where the browser supports passkey autofill, arm it on
  // mount so the email field can offer the user's passkeys before they type
  // a password (the `webauthn` autocomplete token on the field is the other
  // half of the contract). Where it does not, the button below is the
  // fallback and nothing is preloaded.
  useEffect(() => {
    // A property, not a bare `let`: the cleanup writes it from another
    // function, and a closure-captured `let cancelled = false` reads as a
    // literal `false` to the type-aware linter inside this IIFE.
    const state = { cancelled: false }
    void (async () => {
      const available = await conditionalMediationAvailable()
      if (available && !state.cancelled) {
        passkeySignIn.run({ autoFill: true })
      }
    })()
    return () => {
      state.cancelled = true
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the preload runs once per mount; re-arming on every identity change would relaunch the ceremony while it is already pending
  }, [])

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={passkeySignIn.pending}
        onClick={() => {
          // `undefined` = no autofill: the button opens the modal
          // ceremony; the type makes the explicit argument honest.
          passkeySignIn.run(undefined)
        }}
      >
        <FingerprintIcon className="size-4" />
        Sign in with a passkey
      </Button>
      {passkeySignIn.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {passkeySignIn.error}
        </p>
      )}
    </div>
  )
}
