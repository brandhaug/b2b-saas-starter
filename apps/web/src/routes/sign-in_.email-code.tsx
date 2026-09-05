import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  sendEmailCodeWithAuthClient,
  signInWithEmailCodeWithAuthClient,
  type SendEmailCode,
  type SignInWithEmailCode
} from '@/components/auth/auth-client-ports'
import { EmailCodeExchange } from '@/components/auth/email-code-exchange'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export const Route = createFileRoute('/sign-in_/email-code')({
  validateSearch: redirectSearch,
  component: EmailCodeSignInRoute,
  head: () => ({ meta: [{ title: 'Sign in with a code | B2B SaaS Starter' }] })
})

function EmailCodeSignInRoute() {
  const { redirect } = Route.useSearch()
  return <EmailCodeSignInPage redirect={redirect} />
}

/**
 * The code-entry alternative to the password form on /sign-in: step one asks
 * for the email and sends a six-digit code, step two turns the code into a
 * session. Registration is not possible from here — the server's
 * `disableSignUp` refuses codes for unknown addresses, and the endpoint
 * answers identically either way, so an unknown email looks like a sent one.
 * The TOTP gate's `two_factor_required` refusal needs no translation here:
 * the shared code table maps it to the sentence that names the path that
 * still works.
 */
export function EmailCodeSignInPage({
  redirect,
  sendCode = sendEmailCodeWithAuthClient,
  signIn = signInWithEmailCodeWithAuthClient
}: {
  readonly redirect?: string | undefined
  readonly sendCode?: SendEmailCode
  readonly signIn?: SignInWithEmailCode
}) {
  const router = useRouter()
  return (
    <EmailCodeExchange
      purpose="sign-in"
      send={sendCode}
      verify={({ email, otp }) => signIn({ email, otp })}
      onVerified={() => {
        router.history.push(safeRedirect(redirect))
      }}
      title="Enter your code"
      emailTitle="Email me a code"
      emailDescription="We will send a six-digit sign-in code to your email. It works once and expires in ten minutes."
      codeSentNotice="We emailed a six-digit code. It expires in ten minutes."
      codeSentNoticeFor={(email) =>
        `We emailed a six-digit code to ${email}. It expires in ten minutes.`
      }
      codeSubmitLabel="Verify and sign in"
      codeSubmittingLabel="Verifying…"
      emailFooter={
        <p className="text-center text-sm text-muted-foreground">
          Prefer your password?{' '}
          <Link
            to="/sign-in"
            search={redirect ? { redirect } : {}}
            className="text-primary underline underline-offset-4"
          >
            Sign in that way
          </Link>
        </p>
      }
      codeFooter={
        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/sign-in"
            search={redirect ? { redirect } : {}}
            className="text-primary underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      }
    />
  )
}
