import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthCardForm } from './auth-card-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import { authFailure } from '@/lib/auth-result'
import { authErrorCopy } from '@/lib/auth-error-copy'
import { useServerAction } from '@/hooks/use-server-action'
import {
  strongAuthenticationStatusServerFn,
  verifyCurrentPasswordServerFn,
  type StrongAuthenticationStatus
} from '@/lib/server/strong-authentication'
import { safeRedirect } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export function VerifyAuthenticationPage({
  status,
  twoFactorEnabled,
  redirect
}: {
  readonly status: StrongAuthenticationStatus
  readonly twoFactorEnabled: boolean
  readonly redirect?: string | undefined
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const verify = useServerAction(
    async (method: 'password' | 'passkey') => {
      setNotice(null)
      if (method === 'passkey') {
        const result = await authClient.signIn.passkey()
        if (result.error) {
          return authFailure(
            authErrorCopy(result.error, m.security_verification_failed())
          )
        }
      } else {
        const checked = await verifyCurrentPasswordServerFn({ data: { password } })
        if (!checked) {
          return authFailure(m.security_verification_failed())
        }
        setPassword('')
        if (!twoFactorEnabled) {
          setNotice(m.security_enroll_next())
          return null
        }
        const checkedCode = await authClient.twoFactor.verifyTotp({
          code,
          trustDevice: false
        })
        if (checkedCode.error) {
          return authFailure(
            authErrorCopy(checkedCode.error, m.security_verification_failed())
          )
        }
      }
      const current = await strongAuthenticationStatusServerFn()
      if (!current.qualified) {
        return authFailure(m.security_verification_failed())
      }
      // Full navigation reads the newly verified session before loading protected data.
      window.location.assign(safeRedirect(redirect))
      return null
    },
    { failureMessage: m.security_verification_failed(), invalidate: false }
  )

  return (
    <AuthCardForm
      title={m.security_verify_title()}
      description={m.security_authentication_required()}
      form={{ handleSubmit: () => verify.run('password') }}
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
            onClick={() => verify.run('passkey')}
          >
            {m.security_verify_passkey()}
          </Button>
          <Link to="/account" className="text-sm underline underline-offset-4">
            {m.security_manage_factors()}
          </Link>
          <Link to="/forgot-password" className="text-sm underline underline-offset-4">
            {m.forgot_password()}
          </Link>
          <p className="text-sm text-muted-foreground">{m.security_recovery_help()}</p>
        </div>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="security-password">{m.form_password()}</FieldLabel>
          <Input
            id="security-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={verify.pending}
          />
        </Field>
        {twoFactorEnabled ? (
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
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              disabled={verify.pending}
            />
          </Field>
        ) : null}
      </FieldGroup>
    </AuthCardForm>
  )
}
