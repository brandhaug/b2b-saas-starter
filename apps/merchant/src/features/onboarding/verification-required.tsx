import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { merchantAuthClient } from '@/lib/auth-client.ts'

export function VerificationRequired() {
  const router = useRouter()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  return (
    <main className="merchant-safe-area-page grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-lg border bg-card p-6">
        <p className="text-xs font-medium text-foreground">
          Email verification required
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Verify before creating a Merchant
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Until your email is verified, this account can only verify or recover access,
          resend verification, or sign out.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground"
            to="/verify-email"
          >
            Verify or resend
          </Link>
          <Link
            className="inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground"
            to="/forgot-password"
          >
            Recover access
          </Link>
          <button
            className="h-9 rounded-md px-3 text-sm"
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              setSignOutError(null)
              try {
                await merchantAuthClient.signOut()
                router.history.push('/sign-in')
              } catch {
                setSignOutError('Sign out failed. Please try again.')
                setSigningOut(false)
              }
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {signOutError ? (
          <p className="mt-3 text-sm text-destructive">{signOutError}</p>
        ) : null}
      </section>
    </main>
  )
}
