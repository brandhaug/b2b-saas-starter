import { redirect } from '@tanstack/react-router'

export const merchantSessionOrRedirect = <Session>(
  session: Session | null,
  redirectTo: string
): Session => {
  if (!session) {
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  return session
}
