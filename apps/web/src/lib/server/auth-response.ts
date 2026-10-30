import { Effect } from 'effect'
import { BetterAuthApiError } from 'effectful-better-auth'
import { captureResponseCookies } from '../request-context'

export type AuthResponse<A> = {
  readonly headers: Headers
  readonly response: A
}

/** Consume the official full API envelope before callers map or recover its data. */
export function withAuthCookies<A, E, R>(effect: Effect.Effect<AuthResponse<A>, E, R>) {
  return effect.pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error instanceof BetterAuthApiError) {
          captureResponseCookies(new Headers(error.headers))
        }
      })
    ),
    Effect.map(({ headers, response }) => {
      captureResponseCookies(headers)
      return response
    })
  )
}
