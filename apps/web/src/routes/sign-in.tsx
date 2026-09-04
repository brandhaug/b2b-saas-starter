import { useState } from 'react'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { KeyRoundIcon, MailIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { AuthSubmitButton } from '@/components/auth/auth-submit-button'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { PasskeySignIn } from '@/components/auth/passkey-sign-in'
import {
  LastSignInMethodHint,
  SocialSignInButtons
} from '@/components/auth/social-sign-in'
import {
  sendMagicLinkWithAuthClient,
  signInSocialWithAuthClient,
  signInWithAuthClient,
  signInWithSsoAuthClient,
  type SendMagicLink,
  type SignInWithEmail,
  type SignInWithPasskey,
  type SignInWithSocial,
  type SignInWithSso,
  type SocialProviderId
} from '@/components/auth/auth-client-ports'
import { type SsoRoutingDecision } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { FormTextField } from '@/components/form-text-field'
import { TurnstileWidget } from '@/components/auth/turnstile-widget'
import { Button } from '@/components/ui/button'
import { carriedOAuthSearch, oauthContinuationUrl } from '@/lib/oauth-continuation'
import {
  DEMO_CREDENTIALS,
  DEMO_MEMBER_CREDENTIALS,
  DEMO_WORKSPACE_SLUG
} from '@/lib/demo-workspace'
import { getSocialProviderIds } from '@/lib/server/social-providers'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { resolveSsoRoutingServerFn } from '@/lib/server/workspace-sso'
import { redirectSearch, safeRedirect } from '@/lib/utils'

export type {
  SendMagicLink,
  SignInWithEmail,
  SignInWithPasskey,
  SignInWithSso
} from '@/components/auth/auth-client-ports'

/**
 * The domain-routing ask, as a port so a test drives the page without a
 * server. Existence is the answer — a non-null resolution means "this
 * domain routes to an IdP"; the decision's fields are the gate's concern,
 * not the page's (the require-SSO rule is enforced server-side). Type-only
 * import: the route ships statically, so nothing here may load the
 * capability runtime.
 */
export type ResolveSsoRouting = (email: string) => Promise<SsoRoutingDecision | null>

async function resolveSsoRouting(email: string) {
  // A failed ask must not dead-end the form: the password path is the
  // fallback, exactly as it was before SSO existed.
  const decision = await resolveSsoRoutingServerFn({ data: { email } }).catch(
    () => null
  )
  return decision
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: redirectSearch,
  // The active provider ids and the Turnstile site key are read on the server
  // only (env-gated: with nothing configured the loader answers an empty list
  // and `null`, and the page renders exactly what it did before either
  // existed).
  loader: async () => ({
    socialProviders: await getSocialProviderIds(),
    turnstileSiteKey: await getTurnstileSiteKey()
  }),
  component: SignInRoute,
  head: () => ({ meta: [{ title: pageTitle('Sign in') }] })
})

type SignInValues = {
  email: string
  password: string
}

/** Stable empty default: a fresh `[]` literal per render would defeat memoing. */
const NO_SOCIAL_PROVIDERS: ReadonlyArray<SocialProviderId> = []

/**
 * Whether the sign-in response asks for the two-factor hop. A plain field
 * probe rather than an effect Schema: this route is statically imported by the
 * route tree and ships to the browser, so it must not pin the Effect runtime.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Better Auth's response `data` is untyped JSON at this boundary; this probe is the parse step
function wantsTwoFactorRedirect(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * Whether a failed credential sign-in was refused by the require-SSO gate.
 * Same probe discipline: the client's error is untyped JSON at this boundary.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Better Auth's client `error` is untyped JSON at this boundary; this probe is the parse step
function wasRefusedForSso(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'sso_required'
  )
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

// One message for every outcome, by design: the send endpoint answers
// identically whether or not the email exists (account enumeration defense),
// and the screen must not know more than the endpoint does.
const LINK_SENT_MESSAGE =
  'If this email exists in our system, check your inbox for a sign-in link. It works once and expires in ten minutes.'

/**
 * The route's thin wrapper: reads the search param the router validated and
 * the loader's server-provided values, then hands them to the page. Keeping
 * the two apart is what lets the page be rendered from a test with plain
 * props, no route tree and no mocked router.
 */
function SignInRoute() {
  const { redirect } = Route.useSearch()
  const { socialProviders, turnstileSiteKey } = Route.useLoaderData()
  return (
    <SignInPage
      redirect={redirect}
      socialProviders={socialProviders}
      turnstileSiteKey={turnstileSiteKey}
    />
  )
}

export function SignInPage({
  redirect,
  socialProviders = NO_SOCIAL_PROVIDERS,
  signIn = signInWithAuthClient,
  signInPasskey,
  signInSocial = signInSocialWithAuthClient,
  signInWithSso = signInWithSsoAuthClient,
  resolveRouting = resolveSsoRouting,
  sendMagicLink = sendMagicLinkWithAuthClient,
  turnstileSiteKey = null
}: {
  readonly redirect?: string | undefined
  /** Active provider ids from the loader; empty renders no provider buttons. */
  readonly socialProviders?: ReadonlyArray<SocialProviderId>
  readonly signIn?: SignInWithEmail
  readonly signInPasskey?: SignInWithPasskey
  readonly signInSocial?: SignInWithSocial
  readonly signInWithSso?: SignInWithSso
  readonly resolveRouting?: ResolveSsoRouting
  readonly sendMagicLink?: SendMagicLink
  /** Server-provided Turnstile site key; `null` renders no widget (provider-light). */
  readonly turnstileSiteKey?: string | null | undefined
}) {
  const router = useRouter()
  // The Local Auth Paths as one screen's modes: password (default) and the
  // emailed link. Mode is UI state, not a route, so switching loses nothing
  // but the unused field.
  const [mode, setMode] = useState<'password' | 'link'>('password')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [ssoNotice, setSsoNotice] = useState<string | null>(null)
  const [linkSent, setLinkSent] = useState(false)
  // The challenge token; single-use, so a failed send clears it and the
  // visitor answers a fresh challenge on retry.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  const passwordForm = useForm({
    defaultValues: { email: '', password: '' } satisfies SignInValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      setSsoNotice(null)
      // Domain routing first (ADR 0055): an email whose domain belongs to an
      // enabled connection goes to that IdP — the password path is never even
      // attempted. `requireSso` domains are additionally refused server-side,
      // so a direct POST cannot sidestep the rule.
      const routing = await resolveRouting(value.email)
      if (routing !== null) {
        const sso = await signInWithSso({
          email: value.email,
          callbackURL: safeRedirect(redirect)
        })
        if (sso.error) {
          setSubmitError(sso.error.message ?? 'Single sign-in failed')
          return
        }
        if (sso.data?.url) {
          window.location.assign(sso.data.url)
          return
        }
        // Unreachable while the plugin answers a routing match with a URL,
        // but an explicit failure beats silently attempting the password
        // path the routing decision just refused.
        setSubmitError('Single sign-in failed')
        return
      }
      const result = await signIn({
        email: value.email,
        password: value.password
      })
      if (result.error) {
        // The server-side gate answers a require-SSO domain with this code;
        // surface it as guidance rather than a bare failed sign-in.
        if (wasRefusedForSso(result.error)) {
          setSsoNotice(
            'This workspace requires single sign-on for your email domain. Sign in with your identity provider.'
          )
          return
        }
        setSubmitError(result.error.message ?? 'Sign-in failed')
        return
      }
      const twoFactorRedirect =
        result.data !== null &&
        result.data !== undefined &&
        wantsTwoFactorRedirect(result.data)
      if (twoFactorRedirect) {
        // Two-factor is enabled: the credentials set a short-lived challenge
        // cookie, not a session. The code lands on the challenge page, which
        // preserves the redirect target through its own search param — and,
        // for a sign-in an MCP client started, the provider's signed OAuth
        // query, so the verified code resumes that authorization.
        const oauthSearch = carriedOAuthSearch(window.location.search)
        if (oauthSearch) {
          router.history.push(`/two-factor${oauthSearch}`)
          return
        }
        router.history.push(
          redirect
            ? `/two-factor?redirect=${encodeURIComponent(redirect)}`
            : '/two-factor'
        )
        return
      }
      // A sign-in an MCP client started resumes the authorization: the
      // provider answered with the next hop (the consent page, or the client's
      // redirect URI), which may be another origin — a full navigation.
      const continuation = oauthContinuationUrl(result.data)
      if (continuation !== null) {
        window.location.assign(continuation)
        return
      }
      router.history.push(safeRedirect(redirect))
    }
  })

  const linkForm = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      if (turnstileSiteKey !== null && turnstileToken === null) {
        setSubmitError('Complete the bot check before requesting a link.')
        return
      }
      const result = await sendMagicLink({
        email: value.email,
        turnstileToken: turnstileToken ?? undefined
      })
      if (result.error) {
        setTurnstileToken(null)
        setSubmitError(
          result.error.message?.includes('captcha') === true
            ? 'The bot check failed — try the challenge again.'
            : (result.error.message ?? 'Could not send the link')
        )
        return
      }
      setLinkSent(true)
    }
  })

  if (mode === 'link') {
    return (
      <AuthCardForm
        title="Sign in with an email link"
        description="We will email you a link that signs you in without a password."
        // The sent state is a confirmation, not a form — no wrapper, no
        // hydration signal needed.
        form={linkSent ? null : linkForm}
        submit={
          linkSent ? undefined : (
            <AuthSubmitButton
              form={linkForm}
              icon={<MailIcon className="size-4" />}
              label="Email me a sign-in link"
              submittingLabel="Sending…"
            />
          )
        }
        error={submitError}
        footer={footer({
          mode,
          redirect,
          socialProviders,
          signInPasskey
        })}
      >
        {linkSent ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {LINK_SENT_MESSAGE}
          </p>
        ) : (
          <>
            <linkForm.Field name="email" validators={{ onChange: emailValidator }}>
              {(field) => (
                <FormTextField
                  name={field.name}
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  required
                />
              )}
            </linkForm.Field>
            {turnstileSiteKey === null ? null : (
              <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
            )}
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setSubmitError(null)
                setLinkSent(false)
                setMode('password')
              }}
              className="justify-start p-0 text-sm"
            >
              Sign in with password instead
            </Button>
          </>
        )}
      </AuthCardForm>
    )
  }

  return (
    <AuthCardForm
      title="Sign in"
      description="Sign in with your email and password."
      form={passwordForm}
      submit={
        <AuthSubmitButton
          form={passwordForm}
          icon={<KeyRoundIcon className="size-4" />}
          label="Continue"
          submittingLabel="Signing in…"
        />
      }
      error={submitError}
      notice={ssoNotice}
      footer={footer({
        mode,
        redirect,
        socialProviders,
        signInPasskey
      })}
    >
      <LastSignInMethodHint />
      <SocialSignInButtons
        providers={socialProviders}
        redirectTo={redirect}
        signIn={signInSocial}
      />

      <passwordForm.Field name="email" validators={{ onChange: emailValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label="Email"
            type="email"
            placeholder="you@example.com"
            // `webauthn` must be the LAST autocomplete token for the
            // browser's conditional UI to offer passkeys on this field.
            autoComplete="email webauthn"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            required
          />
        )}
      </passwordForm.Field>

      <passwordForm.Field name="password" validators={{ onChange: passwordValidator }}>
        {(field) => (
          <FormTextField
            name={field.name}
            label="Password"
            type="password"
            autoComplete="current-password"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            required
          />
        )}
      </passwordForm.Field>

      <Button
        type="button"
        variant="link"
        onClick={() => {
          setSubmitError(null)
          setMode('link')
        }}
        className="justify-start p-0 text-sm"
      >
        Email me a sign-in link
      </Button>
    </AuthCardForm>
  )
}

/**
 * The shared card footer. The forgot-password link and the passkey block only
 * make sense beside a password field, so they render in password mode only;
 * the seeded-credential hints stay in both modes — the demo address works for
 * a magic link too, which lands in the dev console log (log-mode email) with
 * no provider configured.
 */
function footer({
  mode,
  redirect,
  socialProviders,
  signInPasskey
}: {
  mode: 'password' | 'link'
  redirect?: string | undefined
  socialProviders: ReadonlyArray<SocialProviderId>
  signInPasskey: SignInWithPasskey | undefined
}) {
  return (
    <>
      {mode === 'password' ? (
        <>
          {/* The passkey block sits at the point of action, after the form:
              same destination, different credential. Conditional-UI browsers
              also offer passkeys straight from the email field above. */}
          <PasskeySignIn redirect={redirect} signInPasskey={signInPasskey} />
          {socialProviders.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              The provider buttons sign you in through GitHub or Google; an account with
              a matching verified email is linked automatically.
            </p>
          ) : null}
          <p className="text-right">
            <Link
              to="/sign-in/email-code"
              search={redirect ? { redirect } : {}}
              className="text-sm text-primary underline underline-offset-4"
            >
              Email me a code instead
            </Link>
          </p>
          <p className="text-right">
            <Link
              to="/forgot-password"
              search={{}}
              className="text-sm text-primary underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          </p>
        </>
      ) : null}
      {/* The seed workspace is the public reference app — the hero CTA
          lands behind sign-in, so the credentials stay on the page in
          production too (they exist only after seeding a local D1). */}
      <p className="text-xs text-muted-foreground">
        Seeded the local database? Sign in with{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_CREDENTIALS.email}
        </code>{' '}
        /{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_CREDENTIALS.password}
        </code>
        .
      </p>
      <p className="text-xs text-muted-foreground">
        Or as a plain member, to see the role-gated view:{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_MEMBER_CREDENTIALS.email}
        </code>{' '}
        /{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_MEMBER_CREDENTIALS.password}
        </code>
        .
      </p>
      <Link
        to="/workspaces/$workspaceSlug"
        params={{ workspaceSlug: DEMO_WORKSPACE_SLUG }}
        className="text-center text-sm text-primary underline underline-offset-4"
      >
        Open seeded workspace instead
      </Link>
      <p className="text-center text-sm text-muted-foreground">
        No account yet?{' '}
        <Link
          to="/sign-up"
          search={{}}
          className="text-primary underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </>
  )
}
