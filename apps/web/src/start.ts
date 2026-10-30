import { databaseIsReady } from '@b2b-saas-starter/db/service'
import { isMaintenanceMode } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { Effect } from 'effect'
import { localizeRequest } from './lib/server/i18n-middleware'
import {
  runWebRequestScope,
  webRuntime,
  withWebRequestScope
} from './lib/observability'
import { enforceRequiredEnvOnce } from './lib/server/env-gate'
import { maintenanceResponse } from './lib/maintenance'
import { applyResponseCookies, withRequest } from './lib/request-context'

/** Request identity, telemetry and locale enclose both HTTP calls and SSR. */
export async function runRequest(
  request: Request,
  next: () => Promise<Response>
): Promise<Response> {
  await enforceRequiredEnvOnce()
  return withRequest(request, () =>
    runWebRequestScope(
      {
        request,
        handlerType: new URL(request.url).pathname.startsWith('/api/web/')
          ? 'httpApi'
          : 'document'
      },
      async () => {
        if (new URL(request.url).pathname === '/ready') {
          return webRuntime.runPromise(
            databaseIsReady(env.DB).pipe(
              Effect.map((available) => {
                const ready = available && !isMaintenanceMode(env.MAINTENANCE_MODE)
                return Response.json(
                  { status: ready ? 'ready' : 'not_ready' },
                  { status: ready ? 200 : 503 }
                )
              })
            )
          )
        }
        const maintenance = maintenanceResponse(request, env.MAINTENANCE_MODE)
        if (maintenance) {
          return maintenance
        }
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- unknown thrown values are classified at the Fetch boundary and never serialized
        return localizeRequest(request, next).catch((error: unknown) => {
          if (error instanceof Response) {
            return error
          }
          return webRuntime.runPromise(
            withWebRequestScope(
              { event: 'web.response_failure' },
              Effect.logError(error).pipe(
                Effect.as(
                  Response.json(
                    { error: 'unavailable' },
                    { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
                  )
                )
              )
            )
          )
        })
      }
    ).then(applyResponseCookies)
  )
}
