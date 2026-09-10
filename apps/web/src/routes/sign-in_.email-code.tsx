import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { EmailCodeExchangePage } from '@/components/auth/email-code-exchange'
import { pageTitle } from '@/components/page/page-title'
import { authClient } from '@/lib/auth-client'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { redirectSearch, safeRedirect } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/sign-in_/email-code')({
  validateSearch: redirectSearch,
  // Server-only read, env-gated: `null` renders no widget and sends no token.
  loader: () => getTurnstileSiteKey(),
  component: EmailCodeSignInRoute,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_email_code()) }] })
})

function EmailCodeSignInRoute() {
  const { redirect } = Route.useSearch()
  return (
    <EmailCodeSignInPage redirect={redirect} turnstileSiteKey={Route.useLoaderData()} />
  )
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
  turnstileSiteKey = null
}: {
  readonly redirect?: string | undefined
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const router = useRouter()
  return (
    <EmailCodeExchangePage
      purpose="sign-in"
      turnstileSiteKey={turnstileSiteKey}
      verify={({ email, otp }) => authClient.signIn.emailOtp({ email, otp })}
      onVerified={() => {
        router.history.push(safeRedirect(redirect))
      }}
      title={m.enter_your_code()}
      emailTitle={m.form_email_code()}
      emailDescription={m.public_auth_email_code_description()}
      codeSentNotice={m.public_auth_email_code_sent()}
      codeSentNoticeFor={(email) => m.public_auth_email_code_sent_to({ email })}
      codeSubmitLabel={m.form_verify_sign_in()}
      codeSubmittingLabel={m.verifying()}
      emailFooter={
        <p className="text-center text-sm text-muted-foreground">
          {m.public_auth_prefer_password()}{' '}
          <Link
            to="/sign-in"
            search={redirect ? { redirect } : {}}
            className="text-primary underline underline-offset-4"
          >
            {m.public_auth_sign_in_that_way()}
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
            {m.public_auth_back_to_sign_in()}
          </Link>
        </p>
      }
    />
  )
}
