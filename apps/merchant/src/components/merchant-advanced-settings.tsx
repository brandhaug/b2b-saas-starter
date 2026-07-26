import { type FormEvent, type ReactNode, useState } from 'react'
import { formValue } from '@/lib/form-value.ts'
import { bootstrapPlatformApiToken } from '@/lib/server/platform-api-tokens.ts'
import { rotatePlatformWebhookSecret } from '@/lib/server/platform-webhooks.ts'

export function MerchantAdvancedSettings() {
  const [token, setToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTokenError(null)
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
      setTokenError('Password verification failed or the token could not be created.')
    }
  }

  async function rotateWebhookSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWebhookError(null)
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
      setWebhookError(
        'Password verification failed or the secret could not be rotated.'
      )
    }
  }

  return (
    <div className="grid gap-6">
      <SettingsForm
        title="Platform API token"
        description="Create the first server credential. Your password is verified before the token is issued."
        onSubmit={createToken}
        submitLabel="Create first token"
      >
        <SettingsInput label="Token name" name="name" maxLength={100} />
        <SettingsInput label="Confirm your password" name="password" type="password" />
      </SettingsForm>
      {tokenError ? (
        <p role="alert" className="text-sm text-destructive">
          {tokenError}
        </p>
      ) : null}
      {token ? (
        <OneTimeSecret
          title="Copy this token now"
          value={token}
          onSaved={() => setToken(null)}
        />
      ) : null}

      <SettingsForm
        title="Webhook signing secret"
        description="Rotation requires your current password. The new secret is shown once."
        onSubmit={rotateWebhookSecret}
        submitLabel="Rotate signing secret"
      >
        <SettingsInput label="Endpoint ID" name="endpointId" />
        <SettingsInput label="Confirm your password" name="password" type="password" />
      </SettingsForm>
      {webhookError ? (
        <p role="alert" className="text-sm text-destructive">
          {webhookError}
        </p>
      ) : null}
      {webhookSecret ? (
        <OneTimeSecret
          title="Copy this secret now"
          value={webhookSecret}
          onSaved={() => setWebhookSecret(null)}
        />
      ) : null}
    </div>
  )
}

function SettingsForm({
  children,
  description,
  onSubmit,
  submitLabel,
  title
}: {
  readonly children: ReactNode
  readonly description: string
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly submitLabel: string
  readonly title: string
}) {
  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
      <button
        type="submit"
        className="min-h-10 justify-self-start rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-transform active:scale-[0.98]"
      >
        {submitLabel}
      </button>
    </form>
  )
}

function SettingsInput({
  label,
  maxLength,
  name,
  type
}: {
  readonly label: string
  readonly maxLength?: number | undefined
  readonly name: string
  readonly type?: 'password' | undefined
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
        name={name}
        type={type}
        required
        maxLength={maxLength}
      />
    </label>
  )
}

function OneTimeSecret({
  onSaved,
  title,
  value
}: {
  readonly onSaved: () => void
  readonly title: string
  readonly value: string
}) {
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <code className="mt-2 block break-all font-mono text-xs">{value}</code>
      <button
        className="mt-3 text-xs font-medium underline"
        type="button"
        onClick={onSaved}
      >
        I have saved it
      </button>
    </div>
  )
}
