import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import { EmailCodeExchangeCard } from '@/components/auth/email-code-exchange'
import { PublicLayout } from '@/components/public-layout'
import { authClient } from '@/lib/auth-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { pickOptionalStrings } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search) => pickOptionalStrings(search, ['error']),
  // Server-only read, env-gated: `null` renders no widget and sends no token.
  loader: () => getTurnstileSiteKey(),
  component: VerifyEmailRoute,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_verify_email()) }] })
})

/**
 * The landing page for the verification link. The emailed URL points at the
 * auth handler, which verifies the token and redirects here — success arrives
 * with no params (and a session cookie, via autoSignInAfterVerification),
 * failure with `?error=<code>`. This page reports what already happened, and
 * on failure offers the code as the alternative way to verify.
 */
function VerifyEmailRoute() {
  const { error } = Route.useSearch()
  return <VerifyEmailPage error={error} turnstileSiteKey={Route.useLoaderData()} />
}

export function VerifyEmailPage({
  error,
  turnstileSiteKey = null
}: {
  readonly error?: string | undefined
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const router = useRouter()
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid w-full max-w-md flex-1 gap-4 px-4 py-12 outline-none"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">
              {error ? (
                <span className="flex items-center gap-2">
                  <CircleAlertIcon className="size-5 text-destructive" />
                  {m.email_verification_failed()}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-5 text-status-ok" />
                  {m.email_verified()}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {m.email_verification_invalid()}
                </p>
                <p className="text-sm text-muted-foreground">
                  {m.email_verification_still_signed_in()}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {m.email_verified_ready()}
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/workspaces"
                className="inline-flex items-center text-primary underline underline-offset-4 max-md:min-h-11"
              >
                {m.go_to_workspaces()}
              </Link>
            </p>
          </CardContent>
        </Card>
        {error ? (
          <EmailCodeExchangeCard
            title={m.verify_with_code()}
            purpose="email-verification"
            turnstileSiteKey={turnstileSiteKey}
            verify={({ email, otp }) => authClient.emailOtp.verifyEmail({ email, otp })}
            onVerified={() => {
              // autoSignInAfterVerification means the verify response carries
              // the session cookie; a reload picks it up. The workspaces index
              // is where the session lands everywhere else.
              router.history.push('/workspaces')
            }}
            codeSentNotice={m.email_code_sent_notice()}
            codeSubmitLabel={m.verify_email()}
            codeSubmittingLabel={m.verifying()}
          />
        ) : null}
      </main>
    </PublicLayout>
  )
}
