import {
  makeSentryOptions,
  withHttpMonitor,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/providers'
import * as Sentry from '@sentry/cloudflare'
import { isMaintenanceMode } from '@b2b-saas-starter/env/server'
import {
  enforceSecureEndpoints,
  minimumTlsResponse
} from '@b2b-saas-starter/env/transport'
import { Effect } from 'effect'

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
    // Sentry deliberately skips its options callback for HEAD and OPTIONS.
    // Keep the gate at the actual Worker seam too, before any provider wiring.
    enforceSecureEndpoints(env)
    const tlsResponse = minimumTlsResponse(request, env.ENVIRONMENT)
    if (tlsResponse !== undefined) {
      return Effect.runPromise(Effect.succeed(tlsResponse))
    }
    // Point the wide-event sinks (Sentry/PostHog) at this invocation's env;
    // unset vars keep both providers fully inert. See
    // packages/logger/src/providers.ts.
    wireWideEventProviders(env)
    // Keep liveness and readiness reachable while the shared database is
    // paused for an operator-led restore. Customer traffic is rejected by
    // the handler layer below; probes remain useful during maintenance.
    if (
      isMaintenanceMode(env.MAINTENANCE_MODE) &&
      new URL(request.url).pathname !== '/health' &&
      new URL(request.url).pathname !== '/ready'
    ) {
      return Effect.runPromise(
        Effect.succeed(Response.json({ error: 'maintenance_mode' }, { status: 503 }))
      )
    }
    return withHttpMonitor('api', () => getWebHandler(env)(request))
  }
}

export default Sentry.withSentry((env: ApiEnv) => {
  enforceSecureEndpoints(env)
  return makeSentryOptions('api', env)
}, worker)
