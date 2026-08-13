import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

/**
 * The in-flight server request, or `undefined` when there is none.
 *
 * This is the seam `src/lib/observability.ts` joins nested work to the one
 * request scope through, and the seam its tests replace. It lives in its own
 * module for both reasons: `createIsomorphicFn` keeps `getRequest` out of the
 * browser bundle (client-side navigations re-run loaders with no request to
 * join), and one lookup means one thing to mock.
 */
export const currentRequest: () => Request | undefined = createIsomorphicFn()
  .server(() => ambientRequest())
  .client(() => undefined)

/**
 * `getRequest()` throws when it runs outside TanStack Start's request storage.
 * That is not an error here: no ambient request is a real state — unit tests,
 * scripts, any non-request code path — and it is exactly the `undefined` this
 * function is typed to return.
 */
function ambientRequest(): Request | undefined {
  // oxlint-disable-next-line effect/noTryCatch -- `getRequest()` signals "no request context" by throwing; there is no non-throwing accessor to check first
  try {
    return getRequest()
  } catch {
    return undefined
  }
}
