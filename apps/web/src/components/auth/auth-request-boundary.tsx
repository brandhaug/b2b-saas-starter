import { type ReactNode } from 'react'
import { AuthRequestContext, useAuthRequestScope } from './auth-request'

/** One explicit authentication attempt per screen; autofill is preemptible. */
export function AuthRequestBoundary({ children }: { readonly children: ReactNode }) {
  const scope = useAuthRequestScope()
  return <AuthRequestContext value={scope}>{children}</AuthRequestContext>
}
