import {
  StrongAuthentication,
  type StrongAuthenticationInput
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'

/** Better Auth supplies the authenticated callback identity; the capability rechecks live proof. */
export function hasRecentAuthentication(
  input: StrongAuthenticationInput
): Promise<boolean> {
  return runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.requireRecent(input)
    ).pipe(
      Effect.as(true),
      Effect.catchTag('StrongAuthenticationRequired', () => Effect.succeed(false))
    )
  )
}
