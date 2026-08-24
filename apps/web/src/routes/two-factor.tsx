import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { ShieldCheckIcon } from 'lucide-react'
import { FormTextField } from '@/components/form-text-field'
import { PublicLayout } from '@/components/public-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { safeRedirect } from '@/lib/utils'

const TwoFactorSearch = Schema.Struct({
  redirect: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(TwoFactorSearch)

export const Route = createFileRoute('/two-factor')({
  validateSearch: (search) => decodeSearch(search),
  component: TwoFactorRoute
})

/**
 * Verifying the second factor, as a port. Injected rather than reaching for
 * the `authClient` singleton at the call site so a test drives the form with a
 * real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type VerifyTotpCode = (input: { readonly code: string }) => Promise<{
  readonly error?: { readonly message?: string | undefined } | null
}>

function verifyWithAuthClient(input: Parameters<VerifyTotpCode>[0]) {
  return authClient.twoFactor.verifyTotp({ code: input.code })
}

function TwoFactorRoute() {
  const { redirect } = Route.useSearch()
  return <TwoFactorChallengePage redirect={redirect} />
}

/**
 * The second half of a two-factor sign-in. The credentials step set Better
 * Auth's short-lived two-factor cookie — there is no session yet, and this is
 * the only thing that turns the challenge into one.
 */
export function TwoFactorChallengePage({
  redirect,
  verifyTotp = verifyWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly verifyTotp?: VerifyTotpCode
}) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const result = await verifyTotp({ code: value.code })
      if (result.error) {
        setSubmitError(result.error.message ?? 'Verification failed')
        return
      }
      router.history.push(safeRedirect(redirect))
    }
  })

  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Two-factor verification</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter the six-digit code from your authenticator app to finish signing in.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
              }}
              className="grid gap-4"
            >
              <form.Field
                name="code"
                validators={{
                  onChange: ({ value }) =>
                    /^\d{6}$/.test(value) ? undefined : 'Enter the 6-digit code'
                }}
              >
                {(field) => (
                  <FormTextField
                    name={field.name}
                    label="Verification code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={field.state.value}
                    errors={field.state.meta.errors}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                    required
                  />
                )}
              </form.Field>

              <form.Subscribe
                selector={(state): readonly [boolean, boolean] => [
                  state.canSubmit,
                  state.isSubmitting
                ]}
              >
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit}>
                    <ShieldCheckIcon className="size-4" />
                    {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
                  </Button>
                )}
              </form.Subscribe>

              {submitError ? (
                <p className="text-xs text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
