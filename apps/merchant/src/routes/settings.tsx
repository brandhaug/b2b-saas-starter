import { FormEvent, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { MerchantThemeControl } from '@/components/merchant-theme-control.tsx'
import { useMerchantSignOut } from '@/hooks/use-merchant-sign-out.ts'
import { formValue } from '@/lib/form-value.ts'
import { bootstrapPlatformApiToken } from '@/lib/server/platform-api-tokens.ts'
import { rotatePlatformWebhookSecret } from '@/lib/server/platform-webhooks.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  component: MerchantSettings
})

function MerchantSettings() {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  const signOut = useMerchantSignOut()

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const values = new FormData(event.currentTarget)
    try {
      const created = await bootstrapPlatformApiToken({
        data: {
          name: formValue(values, 'name'),
          password: formValue(values, 'password')
        }
      })
      setToken(created.token)
      event.currentTarget.reset()
    } catch {
      setError('Password verification failed or the token could not be created.')
    }
  }

  async function rotateWebhookSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const values = new FormData(event.currentTarget)
    try {
      const rotated = await rotatePlatformWebhookSecret({
        data: {
          endpointId: formValue(values, 'endpointId'),
          password: formValue(values, 'password')
        }
      })
      setWebhookSecret(rotated.signingSecret)
      event.currentTarget.reset()
    } catch {
      setError('Password verification failed or the secret could not be rotated.')
    }
  }

  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Settings"
      description="Manage Merchant integration credentials and webhook security."
    >
      <div className="overflow-hidden rounded-2xl border bg-muted/30 md:contents">
        <section className="border-b border-border/70 px-4 py-4 last:border-b-0 md:mt-8 md:rounded-xl md:border md:bg-card md:p-6 md:shadow-sm md:last:border-b">
          <h2 className="text-[0.9375rem] leading-[1.375rem] font-semibold md:text-lg md:leading-7">
            Display
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground md:mt-2 md:leading-6">
            Choose how the BeeSolo merchant workspace appears on this device.
          </p>
          <MerchantThemeControl />
        </section>
        <section className="border-b border-border/70 px-4 py-4 last:border-b-0 md:mt-8 md:rounded-xl md:border md:bg-card md:p-6 md:shadow-sm md:last:border-b">
          <h2 className="text-[0.9375rem] leading-[1.375rem] font-semibold md:text-lg md:leading-7">
            Account
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground md:mt-2 md:leading-6">
            End this session on this device and return to the sign-in screen.
          </p>
          <button
            type="button"
            disabled={signOut.pending}
            className="mt-4 h-9 rounded-full border border-destructive/30 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60 md:mt-5 md:h-10 md:rounded-md"
            onClick={signOut.signOut}
          >
            {signOut.pending ? 'Signing out…' : 'Sign out'}
          </button>
          {signOut.error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {signOut.error}
            </p>
          ) : null}
        </section>
        <section className="border-b border-border/70 px-4 py-4 last:border-b-0 md:mt-8 md:rounded-xl md:border md:bg-card md:p-6 md:shadow-sm md:last:border-b">
          <h2 className="text-[0.9375rem] leading-[1.375rem] font-semibold md:text-lg md:leading-7">
            Platform API Tokens
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground md:mt-2 md:leading-6">
            Create the first server credential. Your password is verified and is never
            passed to the token capability.
          </p>
          <form className="mt-4 grid gap-3 md:mt-6 md:gap-4" onSubmit={createToken}>
            <label className="grid gap-1 text-sm">
              Token name
              <input
                className="h-10 border bg-card px-3"
                name="name"
                required
                maxLength={100}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Confirm your password
              <input
                className="h-10 border bg-card px-3"
                name="password"
                type="password"
                required
              />
            </label>
            <button
              className="h-10 justify-self-start bg-primary px-4 text-sm font-medium text-primary-foreground"
              type="submit"
            >
              Create first token
            </button>
          </form>
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          {token ? (
            <div className="mt-6 border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm font-semibold">Copy this token now</p>
              <p className="mt-1 text-xs">It will not be shown again.</p>
              <code className="mt-3 block break-all font-mono text-sm">{token}</code>
              <button
                className="mt-3 text-sm underline"
                type="button"
                onClick={() => setToken(null)}
              >
                I have saved it
              </button>
            </div>
          ) : null}
        </section>
        <section className="border-b border-border/70 px-4 py-4 last:border-b-0 md:mt-8 md:rounded-xl md:border md:bg-card md:p-6 md:shadow-sm md:last:border-b">
          <h2 className="text-[0.9375rem] leading-[1.375rem] font-semibold md:text-lg md:leading-7">
            Webhook signing secret
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground md:mt-2 md:leading-6">
            Rotation requires your current password. The new secret is shown once.
          </p>
          <form
            className="mt-4 grid gap-3 md:mt-6 md:gap-4"
            onSubmit={rotateWebhookSecret}
          >
            <label className="grid gap-1 text-sm">
              Endpoint ID
              <input className="h-10 border bg-card px-3" name="endpointId" required />
            </label>
            <label className="grid gap-1 text-sm">
              Confirm your password
              <input
                className="h-10 border bg-card px-3"
                name="password"
                type="password"
                required
              />
            </label>
            <button
              className="h-10 justify-self-start bg-primary px-4 text-sm font-medium text-primary-foreground"
              type="submit"
            >
              Rotate signing secret
            </button>
          </form>
          {webhookSecret ? (
            <div className="mt-6 border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm font-semibold">Copy this secret now</p>
              <code className="mt-3 block break-all font-mono text-sm">
                {webhookSecret}
              </code>
              <button
                className="mt-3 text-sm underline"
                type="button"
                onClick={() => setWebhookSecret(null)}
              >
                I have saved it
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </MerchantShell>
  )
}
