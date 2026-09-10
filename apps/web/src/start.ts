import { databaseIsReady } from '@b2b-saas-starter/db/service'
import { isMaintenanceMode } from '@b2b-saas-starter/env/server'
import { withHttpMonitor } from '@b2b-saas-starter/logger/providers'
import { Effect } from 'effect'
import { localizeRequest } from '@/lib/server/i18n-middleware'
import { uiErrorAdapter } from '@/lib/ui-error'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from '@tanstack/react-start'
import { runWebRequestScope, webRuntime } from '@/lib/observability'
import { enforceRequiredEnvOnce } from '@/lib/server/env-gate'
import { maintenanceResponse } from '@/lib/maintenance'
import { env as cloudflareEnv } from 'cloudflare:workers'

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
    withHttpMonitor('web', () =>
      runWebRequestScope(
        { request, handlerType, serverFnId: serverFnMeta?.name },
        async () => {
          const result = await next()
          return result.response
        }
      )
    )
)

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === 'serverFn'
})

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

const maintenanceMiddleware = createMiddleware({ type: 'request' }).server(
  ({ request, next }) => {
    if (new URL(request.url).pathname === '/ready') {
      // The probe runs on the app's runtime like every other server-side
      // effect (ADR 0050): a bare `Effect.runPromise` would build and tear
      // down its own, so the readiness check would be the one request whose
      // failures never reach the loggers.
      return webRuntime.runPromise(
        databaseIsReady(cloudflareEnv.DB).pipe(
          Effect.map((available) => {
            const ready =
              available && !isMaintenanceMode(cloudflareEnv.MAINTENANCE_MODE)
            return Response.json(
              { status: ready ? 'ready' : 'not_ready' },
              { status: ready ? 200 : 503 }
            )
          })
        )
      )
    }
    const response = maintenanceResponse(request, cloudflareEnv.MAINTENANCE_MODE)
    return response === null ? next() : response
  }
)

const localeMiddleware = createMiddleware({ type: 'request' }).server(
  ({ request, next }) =>
    localizeRequest(request, async () => {
      const result = await next()
      return result.response
    })
)

export const startInstance = createStart(() => ({
  serializationAdapters: [uiErrorAdapter],
  requestMiddleware: [
    configGateMiddleware,
    maintenanceMiddleware,
    observabilityMiddleware,
    csrfMiddleware,
    localeMiddleware
  ]
}))
