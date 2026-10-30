import { Effect, Schema } from 'effect'
import { causeMessage } from '@/lib/cause-message'
import { UiError, isStrongAuthenticationError, type UiErrorCode } from '@/lib/ui-error'
import { navigateDocument } from '@/lib/document-navigation'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a class factory, not an Error constructor.
export class RequestFailure extends Schema.TaggedError<RequestFailure>()(
  'RequestFailure',
  {
    message: Schema.String
  }
) {}

/** Browser transport failure policy shared by native commands. */
export function call<A>(
  run: () => Promise<A>,
  fallback: string,
  copy: Partial<Record<UiErrorCode, string>> = {}
): Effect.Effect<A, RequestFailure> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (error instanceof UiError && isStrongAuthenticationError(error)) {
          yield* Effect.sync(() =>
            navigateDocument(
              `/verify-authentication?recent=true&redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`
            )
          )
        }
        return yield* new RequestFailure({
          message:
            (error instanceof UiError ? copy[error.code] : undefined) ??
            causeMessage(error, fallback)
        })
      })
    )
  )
}
