import { Link, useLocation } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'

export function StrongAuthenticationNotice() {
  const location = useLocation()
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-2xl font-semibold">{m.security_verify_title()}</h1>
      <p className="text-muted-foreground">{m.security_authentication_required()}</p>
      <Link
        to="/verify-authentication"
        search={{ redirect: location.href }}
        className="text-primary underline underline-offset-4"
      >
        {m.security_verify_continue()}
      </Link>
      <Link to="/account" className="text-sm underline underline-offset-4">
        {m.security_manage_factors()}
      </Link>
    </main>
  )
}
