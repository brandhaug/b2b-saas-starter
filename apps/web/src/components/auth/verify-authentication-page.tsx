import { useState, type ComponentProps } from 'react'
import { useForm } from '@tanstack/react-form'
import { useAuthRequest } from './auth-request'
import { Link } from '@tanstack/react-router'
import { AuthCardForm } from './auth-card-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import { authErrorCopy } from '@/lib/auth-error-copy'
import {
  strongAuthenticationStatusServerFn,
  verifyCurrentPasswordServerFn,
  type StrongAuthenticationStatus
} from '@/lib/server/strong-authentication'
import { safeRedirect } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export function VerifyAuthenticationPage(
  props: ComponentProps<typeof VerifyAuthenticationContent>
) {
  return (
    <VerifyAuthenticationContent
      key={`${props.redirect ?? ''}:${props.recent ?? false}:${props.twoFactorEnabled}`}
      {...props}
    />
  )
}

function VerifyAuthenticationContent({
  status,
  twoFactorEnabled,
  redirect,
  recent = false
}: {
  readonly status: StrongAuthenticationStatus
  readonly twoFactorEnabled: boolean
  readonly recent?: boolean
  readonly redirect?: string | undefined
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const verify = useAuthRequest(m.security_verification_failed())
  const form = useForm({
    defaultValues: { password: '', code: '' },
    onSubmit: async ({ value }) => run('password', value)
  })
  async function run(method: 'password' | 'passkey', value = form.state.values) {
    await verify.run(async (request) => {
      setNotice(null)
      if (method === 'passkey') {
        const result = await authClient.signIn.passkey(undefined, {
          signal: request.signal
        })
        if (!request.current()) {
          return
        }
        if (result.error) {
          return authErrorCopy(result.error, m.security_verification_failed())
        }
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- cancelled SDK ceremonies can have no response body
        if (result.data === null || result.data === undefined) {
          return m.security_verification_failed()
        }
      } else {
        const checked = await verifyCurrentPasswordServerFn({
          data: { password: value.password }
        })
        if (!request.current()) {
          return
        }
        if (!checked) {
          return m.security_verification_failed()
        }
        form.setFieldValue('password', '')
        if (!twoFactorEnabled && !recent) {
          setNotice(m.security_enroll_next())
          return null
        }
        if (twoFactorEnabled) {
          const checkedCode = await authClient.twoFactor.verifyTotp({
            code: value.code,
            trustDevice: false
          })
          if (!request.current()) {
            return
          }
          if (checkedCode.error) {
            return authErrorCopy(checkedCode.error, m.security_verification_failed())
          }
        }
      }
      const current = await strongAuthenticationStatusServerFn()
      if (!request.current()) {
        return
      }
      if (recent ? !current.recent : !current.qualified) {
        return m.security_verification_failed()
      }
      // Full navigation reads the newly verified session before loading protected data.
      request.win()
      window.location.assign(safeRedirect(redirect))
      return null
    })
  }

  return (
    <AuthCardForm
      title={m.security_verify_title()}
      description={
        recent
          ? m.security_recent_authentication_required()
          : m.security_authentication_required()
      }
      form={form}
      error={verify.error}
      notice={notice ?? (status.recovering ? m.security_recovery_notice() : null)}
      submit={
        <Button type="submit" disabled={verify.pending}>
          {twoFactorEnabled
            ? m.security_verify_continue()
            : m.security_confirm_password()}
        </Button>
      }
      footer={
        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={verify.pending}
            onClick={() => void run('passkey')}
          >
            {m.security_verify_passkey()}
          </Button>
          <Link
            to="/account"
            search={{
              redirect:
                redirect && safeRedirect(redirect) !== '/account'
                  ? safeRedirect(redirect)
                  : undefined
            }}
            className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
          >
            {m.security_manage_factors()}
          </Link>
          <Link
            to="/forgot-password"
            className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
          >
            {m.forgot_password()}
          </Link>
          <p className="text-sm text-muted-foreground">{m.security_recovery_help()}</p>
        </div>
      }
    >
      <FieldGroup>
        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="security-password">{m.form_password()}</FieldLabel>
              <Input
                id="security-password"
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
                disabled={verify.pending}
              />
            </Field>
          )}
        </form.Field>
        {twoFactorEnabled ? (
          <form.Field name="code">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="security-code">
                  {m.security_authenticator_code()}
                </FieldLabel>
                <Input
                  id="security-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  required
                  disabled={verify.pending}
                />
              </Field>
            )}
          </form.Field>
        ) : null}
      </FieldGroup>
    </AuthCardForm>
  )
}
