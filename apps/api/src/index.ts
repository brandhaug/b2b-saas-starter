import type { ApiEnv } from './env.ts'
import { getWebHandler } from './http.ts'
import { handleSmsoCallbackEdge, isSmsoCallbackPath } from './smso-callback.ts'

// The worker serves the `BookingProductApi` contract directly: routing,
// request/response schema decoding, OpenAPI (/openapi.json), the Scalar
// reference (/reference), auth, rate limiting, and wide-event logging are all
// driven by the contract + handler layers in handlers.ts / http.ts. There is no
// hand-maintained route table to drift from the contract.
export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    if (isSmsoCallbackPath(request)) return handleSmsoCallbackEdge(request, env)
    return getWebHandler(env)(request)
  }
}
