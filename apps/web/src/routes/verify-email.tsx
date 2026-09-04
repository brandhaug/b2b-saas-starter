import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import {
  sendEmailCodeWithAuthClient,
  verifyEmailWithCodeWithAuthClient,
  type SendEmailCode,
  type VerifyEmailWithCode
} from '@/components/auth/auth-client-ports'
import { EmailCodeExchange } from '@/components/auth/email-code-exchange'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pickOptionalStrings } from '@/lib/utils'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search) => pickOptionalStrings(search, ['error']),
  component: VerifyEmailRoute,
  head: () => ({ meta: [{ title: pageTitle('Verify email') }] })
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
  return <VerifyEmailPage error={error} />
}

export function VerifyEmailPage({
  error,
  sendCode = sendEmailCodeWithAuthClient,
  verifyCode = verifyEmailWithCodeWithAuthClient
}: {
  readonly error?: string | undefined
  readonly sendCode?: SendEmailCode
  readonly verifyCode?: VerifyEmailWithCode
}) {
  const router = useRouter()
  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 gap-4 px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">
              {error ? (
                <span className="flex items-center gap-2">
                  <CircleAlertIcon className="size-5 text-destructive" />
                  Verification failed
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-5 text-primary" />
                  Email verified
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This verification link is invalid or has expired. Links work once and
                  expire after an hour.
                </p>
                <p className="text-sm text-muted-foreground">
                  Still signed in? The banner on your workspaces page can send a fresh
                  link.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your email address is verified. You are signed in and ready to go.
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/workspaces"
                className="text-primary underline underline-offset-4"
              >
                Go to your workspaces
              </Link>
            </p>
          </CardContent>
        </Card>
        {error ? (
          <EmailCodeExchange
            layout="card"
            title="Or verify with a code"
            purpose="email-verification"
            send={sendCode}
            verify={({ email, otp }) => verifyCode({ email, otp })}
            onVerified={() => {
              // autoSignInAfterVerification means the verify response carries
              // the session cookie; a reload picks it up. The workspaces index
              // is where the session lands everywhere else.
              router.history.push('/workspaces')
            }}
            codeSentNotice="We emailed a six-digit code. It expires in ten minutes."
            codeSubmitLabel="Verify email"
            codeSubmittingLabel="Verifying…"
          />
        ) : null}
      </main>
    </PublicLayout>
  )
}
