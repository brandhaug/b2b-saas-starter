import { Link, useLocation } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { PublicLayout } from '@/components/public-layout'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The privileged-auth gate: the page an elevated actor meets when the session
 * has not been verified recently enough for what it is asking to read.
 *
 * It is a page of the site, not a crash screen, so it renders with the site's
 * landmarks and the skip link `PublicLayout` owns. The `<main>` carries
 * `tabIndex={-1}` so that skip link moves focus rather than only the scroll
 * position; no focus ring is drawn, because nothing here is operated by
 * pointer or keyboard as a control.
 *
 * `redirect` carries the location the actor was trying to reach, so
 * /verify-authentication returns them to it.
 */
export function StrongAuthenticationNotice() {
  const location = useLocation()
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16 outline-none sm:px-6"
      >
        <h1 className="text-3xl font-semibold tracking-tight">
          {m.security_verify_title()}
        </h1>
        <p className="text-muted-foreground">{m.security_authentication_required()}</p>
        <Button
          nativeButton={false}
          className="self-start"
          render={
            <Link to="/verify-authentication" search={{ redirect: location.href }} />
          }
        >
          {m.security_verify_continue()}
        </Button>
        <Link
          to="/account"
          className="inline-flex items-center text-sm underline underline-offset-4 max-md:min-h-11"
        >
          {m.security_manage_factors()}
        </Link>
      </main>
    </PublicLayout>
  )
}
