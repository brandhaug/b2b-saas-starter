import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { FingerprintIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { conditionalMediationAvailable } from '@/lib/webauthn-support'
import { oauthContinuationUrl } from '@/lib/oauth-continuation'
import { safeRedirect } from '@/lib/utils'
import { useAuthRequest, type AuthRequest } from './auth-request'
import { m } from '@b2b-saas-starter/i18n/messages'

/** Passive discovery never disables the explicit fallback or announces failures. */
export function PasskeySignIn({
  redirect
}: {
  readonly redirect?: string | undefined
}) {
  const router = useRouter()
  const explicit = useAuthRequest(m.public_auth_passkey_sign_in_failed())
  const passive = useAuthRequest(m.public_auth_passkey_sign_in_failed())

  async function authenticate(request: AuthRequest, autoFill: boolean) {
    const result = await authClient.signIn.passkey(
      autoFill ? { autoFill: true } : undefined,
      { signal: request.signal }
    )
    if (!request.current()) {
      return
    }
    if (result.error) {
      return authErrorCopy(result.error, m.public_auth_passkey_sign_in_failed())
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the SDK can return an empty body for a cancelled ceremony
    if (result.data !== null && result.data !== undefined) {
      request.win()
      const continuation = oauthContinuationUrl(result.data)
      if (continuation === null) {
        router.history.push(safeRedirect(redirect))
      } else {
        window.location.assign(continuation)
      }
    }
    return null
  }

  useEffect(() => {
    const lifetime = { cancelled: false }
    void conditionalMediationAvailable()
      .then((available) => {
        if (available && !lifetime.cancelled) {
          void passive.run(async (request) => {
            await authenticate(request, true)
          }, true)
        }
        return null
      })
      .catch(() => undefined)
    return () => {
      lifetime.cancelled = true
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- conditional discovery is armed once per mounted screen
  }, [])

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={explicit.pending}
        onClick={() => {
          void explicit.run(async (request) => {
            const error = await authenticate(request, false)
            if (error) {
              return error
            }
          })
        }}
      >
        <FingerprintIcon className="size-4" />
        {m.public_auth_sign_in_with_passkey()}
      </Button>
      {explicit.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {explicit.error}
        </p>
      )}
    </div>
  )
}
