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
import { formatDateTime, formatTimestampOr } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

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
        m.token_replace_failed()
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
          <AlertTitle>{m.replacement_copy_notice()}</AlertTitle>
          <AlertDescription>
            <SecretReveal
              secret={created.token}
              label={m.form_replacement_token()}
              className="flex items-center gap-2"
            />
            <p>
              {m.token_update_clients_expiry({
                time: formatDateTime(created.previousTokenExpiresAt)
              })}
            </p>
            <p>
              {m.token_replacement_expiry()}{' '}
              {formatTimestampOr(created.expiresAt, m.never())}.
            </p>
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onClose} className="justify-self-start">
          {m.action_close_replacement()}
        </Button>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      aria-label={m.action_replace_named({ name: token.name })}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <h3 className="text-sm font-medium">
        {m.action_replace_named({ name: token.name })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {m.token_replacement_guidance()}{' '}
        {formatTimestampOr(token.expiresAt, m.token_replacement_overlap_fallback())}.
      </p>
      <p className="text-xs text-muted-foreground">
        {m.token_replacement_inherits_expiry()}{' '}
        {formatTimestampOr(token.expiresAt, m.never())}. {m.token_keep_remove_scopes()}
      </p>
      <form.Field
        name="scopes"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? m.replacement_scope_required() : undefined
        }}
      >
        {(field) => (
          <CheckboxSetField
            name="replacement-scopes"
            legend={m.token_replacement_scopes()}
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
              ? m.token_overlap_range()
              : undefined
          }
        }}
      >
        {(field) => (
          <FormTextField
            name="replacement-overlap"
            label={m.form_overlap()}
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
      <p className="text-xs text-muted-foreground">{m.token_overlap_hint()}</p>
      <form.Subscribe
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, pending]) => (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {m.token_create_replacement()}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              {m.common_cancel()}
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
