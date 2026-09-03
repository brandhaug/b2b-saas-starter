import { WorkspaceExports } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { Effect, Option, Result, Schema } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'

import { type ApiEnv } from './env.ts'
import { enforceRateLimit, observed } from './request-guards.ts'

/**
 * `GET /exports/:exportId/download?expires=<unix>&signature=<hex>` — the
 * signed, time-limited download the web app and the REST `download-link`
 * operation hand out (ADR 0054).
 *
 * Public by design: the signature is the credential. The capability verifies
 * it against the export's own secret, checks the expiry and the artifact's
 * retention horizon, reads the object, and records
 * `workspace.export_downloaded`. Every refusal is one 404 — an unknown id, a
 * bad signature, and an expired link are indistinguishable to a probing
 * client. Not a contract operation: the response is a ZIP, not a schema, and
 * the OpenAPI document must not advertise a route no bearer token reaches.
 */

const DownloadQuery = Schema.Struct({
  expires: Schema.NumberFromString,
  signature: Schema.String
})

const decodeQuery = Schema.decodeUnknownResult(DownloadQuery)

const notFound = HttpServerResponse.empty({ status: 404 })

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
          signature: url.searchParams.get('signature')
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
        const exports = yield* WorkspaceExports
        const download = yield* exports.openDownload({
          exportId,
          expires: query.success.expires,
          signature: query.success.signature
        })
        if (Option.isNone(download)) {
          yield* Effect.annotateLogsScoped({ outcome: 'not_found' })
          return notFound
        }
        yield* Effect.annotateLogsScoped({ sizeBytes: download.value.sizeBytes })
        return HttpServerResponse.uint8Array(download.value.body, {
          contentType: 'application/zip',
          headers: {
            'content-disposition': `attachment; filename="${download.value.fileName}"`,
            'cache-control': 'private, no-store'
          }
        })
      }).pipe(
        // A rate-limited or unavailable download is still a plain response on
        // this non-contract route; the wide event above carries the failure.
        Effect.catchTag('RateLimited', () =>
          Effect.succeed(HttpServerResponse.empty({ status: 429 }))
        ),
        Effect.catchTag('CapabilityUnavailable', () =>
          Effect.succeed(HttpServerResponse.empty({ status: 503 }))
        )
      )
    )
  )
}
