import { guardFailureResponse, type RateLimited } from '@b2b-saas-starter/api/errors'
import {
  WorkspaceExports,
  type WorkspaceExportHumanRecipient
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { memberPrincipal } from '@b2b-saas-starter/authz/client'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, Option, Result, Schema } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'

import { type ApiEnv } from './env.ts'
import { enforceRateLimit, observed, provideWorkspace } from './request-guards.ts'

/**
 * `GET /exports/:exportId/download?expires=<unix>&signature=<hex>` — the
 * signed, time-limited download the web app and the REST `download-link`
 * operation hand out (ADR 0055).
 *
 * The signature is the download credential. Human links also bind the issuing
 * user, session and Workspace; this boundary rechecks recent authentication
 * and current membership before the capability verifies the complete signature,
 * checks expiry and retention, reads the object, and records
 * `workspace.export_downloaded`. Every refusal is one 404 — an unknown id, a
 * bad signature, and an expired link are indistinguishable to a probing
 * client. Not a contract operation: the response is a gzipped JSON document,
 * not a schema, and the OpenAPI document must not advertise a route no bearer
 * token reaches.
 */

const DownloadQuery = Schema.Struct({
  expires: Schema.NumberFromString,
  signature: Schema.String,
  user: Schema.NullOr(Schema.NonEmptyString),
  session: Schema.NullOr(Schema.NonEmptyString),
  workspace: Schema.NullOr(Schema.NonEmptyString)
})

const decodeQuery = Schema.decodeUnknownResult(DownloadQuery)

const notFound = HttpServerResponse.empty({ status: 404 })

/**
 * A guard failure as a plain response on this non-contract route: status and
 * body both come from the contract's own error annotations
 * (`guardFailureResponse`), so the refusal reads exactly like the same
 * failure on a REST route — the same thing `POST /mcp` does. Only the gzip
 * response and the 404s above are this route's own shape.
 */
function guardResponse(
  error: RateLimited | CapabilityUnavailable
): HttpServerResponse.HttpServerResponse {
  const { status, body } = guardFailureResponse(error)
  return HttpServerResponse.jsonUnsafe(body, { status })
}

export function exportDownloadLayer(env: ApiEnv) {
  return HttpRouter.add('GET', '/exports/:exportId/download', (request) =>
    observed(
      env,
      request,
      'workspace-exports.download',
      {},
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const exportId = params.exportId ?? ''
        const url = new URL(request.url, 'http://request.invalid')
        const query = decodeQuery({
          expires: url.searchParams.get('expires'),
          signature: url.searchParams.get('signature'),
          user: url.searchParams.get('user'),
          session: url.searchParams.get('session'),
          workspace: url.searchParams.get('workspace')
        })
        yield* Effect.annotateLogsScoped({ exportId })
        // The public route draws from the read bucket, keyed by client IP,
        // so a signature can't be brute-forced at line rate.
        yield* enforceRateLimit(request, 'rest_read')
        if (Result.isFailure(query)) {
          yield* Effect.annotateLogsScoped({
            outcome: 'not_found',
            skipReason: 'bad_query'
          })
          return notFound
        }
        const { user, session, workspace } = query.success
        let human: WorkspaceExportHumanRecipient | undefined
        if (user !== null || session !== null || workspace !== null) {
          if (user === null || session === null || workspace === null) {
            return notFound
          }
          human = { userId: user, sessionId: session, workspaceSlug: workspace }
          const authentication = yield* StrongAuthentication
          yield* authentication.requireRecent(human)
          yield* provideWorkspace(
            env,
            workspace,
            Effect.gen(function* () {
              const context = yield* WorkspaceContext
              if (!context.actor) {
                return yield* requirePermission(null, { workspaceExport: ['download'] })
              }
              yield* requirePermission(memberPrincipal(context.actor.role), {
                workspaceExport: ['download']
              })
            }),
            { userId: user },
            'user'
          )
        }
        const exports = yield* WorkspaceExports
        const download = yield* exports.openDownload({
          exportId,
          expires: query.success.expires,
          signature: query.success.signature,
          human
        })
        if (Option.isNone(download)) {
          yield* Effect.annotateLogsScoped({ outcome: 'not_found' })
          return notFound
        }
        yield* Effect.annotateLogsScoped({ sizeBytes: download.value.sizeBytes })
        return HttpServerResponse.uint8Array(download.value.body, {
          contentType: 'application/gzip',
          headers: {
            'content-disposition': `attachment; filename="${download.value.fileName}"`,
            'cache-control': 'private, no-store'
          }
        })
      }).pipe(
        Effect.catchTag(
          ['StrongAuthenticationRequired', 'WorkspaceNotFound', 'AuthorizationDenied'],
          () => Effect.succeed(notFound)
        ),
        Effect.catchTag('WorkspaceSuspended', () =>
          Effect.annotateLogsScoped({
            outcome: 'not_found',
            skipReason: 'workspace_suspended'
          }).pipe(Effect.as(notFound))
        ),
        // A rate-limited or unavailable download is still a plain response on
        // this non-contract route; the wide event above carries the failure.
        Effect.catchTag('RateLimited', (error) => Effect.succeed(guardResponse(error))),
        Effect.catchTag('CapabilityUnavailable', (error) =>
          Effect.succeed(guardResponse(error))
        )
      )
    )
  )
}
