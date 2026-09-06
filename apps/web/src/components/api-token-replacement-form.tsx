import {
  type ApiToken,
  type ReplacedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { CheckboxSetField } from '@/components/checkbox-set-field'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SecretReveal } from '@/components/secret-reveal'
import { Spinner } from '@/components/ui/spinner'
import { FormTextField } from '@/components/form-text-field'
import {
  replaceApiTokenServerFn,
  type ReplaceApiTokenInput
} from '@/lib/server/api-tokens'
import { callServerFn } from '@/lib/server-call'
import { formatUtcOr } from '@/lib/format-date'

export type ReplaceApiToken = (input: {
  readonly data: Omit<ReplaceApiTokenInput, 'scopes'> & {
    readonly scopes: ApiToken['scopes']
  }
}) => Promise<ReplacedApiToken>

export function ApiTokenReplacementForm({
  workspaceSlug,
  token,
  replaceToken = replaceApiTokenServerFn,
  onReplaced,
  onClose
}: {
  readonly workspaceSlug: string
  readonly token: ApiToken
  readonly replaceToken?: ReplaceApiToken
  readonly onReplaced: () => Promise<void>
  readonly onClose: () => void
}) {
  const [created, setCreated] = useState<ReplacedApiToken | null>(null)
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { scopes: token.scopes, overlapSeconds: '3600' },
    onSubmit: async ({ value }) => {
      setError(null)
      const result = await callServerFn(
        () =>
          replaceToken({
            data: {
              workspaceSlug,
              tokenId: token.id,
              scopes: value.scopes,
              overlapSeconds: Number(value.overlapSeconds)
            }
          }),
        'Failed to replace token'
      )
      if (!result.ok) {
        setError(result.message)
        return
      }
      setCreated(result.value)
      await onReplaced()
    }
  })

  if (created) {
    return (
      <div className="grid gap-4">
        <Alert variant="ok">
          <AlertTitle>
            Replacement created. Copy it now, it will not be shown again.
          </AlertTitle>
          <AlertDescription>
            <SecretReveal
              secret={created.token}
              label="Replacement API token"
              className="flex items-center gap-2"
            />
            <p>
              Update your clients with this token. The old credential expires at{' '}
              {formatUtcOr(created.previousTokenExpiresAt, 'now')} UTC.
            </p>
            <p>Replacement expiry: {formatUtcOr(created.expiresAt, 'never')}.</p>
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onClose} className="justify-self-start">
          Close replacement
        </Button>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      aria-label={`Replace ${token.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <h3 className="text-sm font-medium">Replace {token.name}</h3>
      <p className="text-sm text-muted-foreground">
        Copy the replacement, update your clients, then revoke the old credential when
        they are ready. Its expiry will never move later than{' '}
        {formatUtcOr(token.expiresAt, 'the overlap you choose')}.
      </p>
      <p className="text-xs text-muted-foreground">
        The replacement stays in this workspace and inherits expiry:{' '}
        {formatUtcOr(token.expiresAt, 'never')}. You can keep or remove scopes.
      </p>
      <form.Field
        name="scopes"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? 'Pick at least one scope' : undefined
        }}
      >
        {(field) => (
          <CheckboxSetField
            name="replacement-scopes"
            legend="Replacement scopes"
            options={token.scopes}
            value={field.state.value}
            errors={field.state.meta.errors}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field
        name="overlapSeconds"
        validators={{
          onChange: ({ value }) => {
            const seconds = Number(value)
            return value === '' ||
              !Number.isInteger(seconds) ||
              seconds < 0 ||
              seconds > 86_400
              ? 'Choose between 0 and 86400 seconds'
              : undefined
          }
        }}
      >
        {(field) => (
          <FormTextField
            name="replacement-overlap"
            label="Old credential overlap (seconds)"
            type="number"
            min="0"
            max="86400"
            step="1"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <p className="text-xs text-muted-foreground">
        Use 0 to retire the old credential immediately. The maximum overlap is 24 hours;
        an earlier expiry still applies.
      </p>
      <form.Subscribe
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, pending]) => (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}Create replacement
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </form.Subscribe>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}
