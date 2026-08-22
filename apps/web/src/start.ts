import { createMiddleware, createStart } from '@tanstack/react-start'
import { runWebRequestScope } from '@/lib/observability'
import { enforceRequiredEnvOnce } from '@/lib/server/env-gate'

/**
 * One wide event per web request. Every server request — SSR document renders
 * and server-function calls alike — passes through here, so this is the only
 * place the web worker opens a request scope: it continues any inbound
 * `traceparent`, builds the OTLP exporters for this invocation, and emits the
 * canonical line when the response is ready. Loaders and server functions join
 * the scope through `withWebRequestScope` instead of opening their own.
 */
const observabilityMiddleware = createMiddleware({ type: 'request' }).server(
  ({ request, next, handlerType, serverFnMeta }) =>
    runWebRequestScope(
      { request, handlerType, serverFnId: serverFnMeta?.name },
      async () => {
        const result = await next()
        return result.response
      }
    )
)

const configGateMiddleware = createMiddleware({ type: 'request' }).server(
  ({ next }) => {
    // Before the request scope opens: the gate's `config.insecure` event (a
    // non-production deployment with insecure required env) is standalone, not
    // folded into the first request's wide event. In production the gate
    // throws, failing every request until the deployment is fixed.
    enforceRequiredEnvOnce()
    return next()
  }
)

export const startInstance = createStart(() => ({
  requestMiddleware: [configGateMiddleware, observabilityMiddleware]
}))
