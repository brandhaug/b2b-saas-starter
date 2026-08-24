import {
  makeSentryOptions,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/src/providers.ts'
import * as Sentry from '@sentry/cloudflare'

import { type ApiEnv } from './env.ts'
import { getWebHandler } from './http.ts'

// The worker serves the `StarterApi` HttpApi contract directly: routing,
// request/response schema decoding, OpenAPI (/openapi.json), the Scalar
// reference (/reference), auth, rate limiting, and wide-event logging are all
// driven by the contract + handler layers in handlers.ts / http.ts. There is no
// hand-maintained route table to drift from the contract.
const worker = {
  // Not `async`: the Workers runtime awaits the returned promise, and the
  // handler has nothing to await before returning it.
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    // Point the wide-event sinks (Sentry/PostHog) at this invocation's env;
    // unset vars keep both providers fully inert. See
    // packages/logger/src/providers.ts.
    wireWideEventProviders(env)
    return getWebHandler(env)(request)
  }
}

export default Sentry.withSentry((env: ApiEnv) => makeSentryOptions('api', env), worker)
