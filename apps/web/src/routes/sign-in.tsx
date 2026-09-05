import { pageTitle } from '@/components/page/page-title'
import { createFileRoute } from '@tanstack/react-router'
import { SignInPage } from '@/components/auth/sign-in-page'
import { getSocialProviderIds } from '@/lib/server/social-providers'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { pickOptionalStrings } from '@/lib/utils'

// The page itself (card contents, outcome ladder, footer) lives in
// `components/auth/sign-in-page.tsx`, beside the other auth components; this
// file is the route: search validation, the loader's server-only reads, and
// composition.

export const Route = createFileRoute('/sign-in')({
  // `redirect` rides every hop; `error` arrives once — the TOTP gate's
  // magic-link refusal redirects the browser here with
  // `two_factor_required`, and that landing owes the visitor the notice that
  // says why the link did not sign them in.
  validateSearch: (search) => pickOptionalStrings(search, ['redirect', 'error']),
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

/**
 * The route's thin wrapper: reads the search params the router validated and
 * the loader's server-provided values, then hands them to the page. Keeping
 * the two apart is what lets the page be rendered from a test with plain
 * props, no route tree and no mocked router.
 */
function SignInRoute() {
  const { redirect, error } = Route.useSearch()
  const { socialProviders, turnstileSiteKey } = Route.useLoaderData()
  return (
    <SignInPage
      redirect={redirect}
      searchError={error}
      socialProviders={socialProviders}
      turnstileSiteKey={turnstileSiteKey}
    />
  )
}
