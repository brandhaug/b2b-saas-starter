import { createFileRoute } from '@tanstack/react-router'
import { VerifyAuthenticationPage } from '@/components/auth/verify-authentication-page'
import { pageTitle } from '@/components/page/page-title'
import { requireSession } from '@/lib/server/auth'
import { strongAuthenticationStatusServerFn } from '@/lib/server/strong-authentication'
import { pickOptionalStrings } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/verify-authentication')({
  validateSearch: (search) => pickOptionalStrings(search, ['redirect', 'recent']),
  beforeLoad: async ({ location }) => ({
    session: await requireSession(location.href)
  }),
  loader: () => strongAuthenticationStatusServerFn(),
  component: VerificationRoute,
  head: () => ({ meta: [{ title: pageTitle(m.security_verify_title()) }] })
})

function VerificationRoute() {
  const { session } = Route.useRouteContext()
  const { redirect, recent } = Route.useSearch()
  const status = Route.useLoaderData()
  return (
    <VerifyAuthenticationPage
      status={status}
      twoFactorEnabled={session.user.twoFactorEnabled}
      redirect={redirect}
      recent={recent === 'true'}
    />
  )
}
