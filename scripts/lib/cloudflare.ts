import { fromApiToken, type Credentials } from '@distilled.cloud/cloudflare/Credentials'
import { none } from '@distilled.cloud/cloudflare/Retry'
import { Effect, Redacted, Schema } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse
} from 'effect/http'

const decodeSuccess = HttpClientResponse.schemaBodyJson(
  Schema.Struct({ success: Schema.Literal(true) })
)

/** The SDK is lenient about envelopes; mutations require affirmative acknowledgement. */
export function requireCloudflareSuccess(client: HttpClient.HttpClient) {
  return HttpClient.transformResponse(HttpClient.filterStatusOk(client), (response) =>
    response.pipe(
      Effect.flatMap((value) =>
        decodeSuccess(value).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.DecodeError({
                  request: value.request,
                  response: value,
                  description: 'Malformed Cloudflare acknowledgement'
                })
              })
          ),
          Effect.as(value)
        )
      )
    )
  )
}

/** Operator calls never retry implicitly, especially message publication. */
export function withCloudflareToken<A, E>(
  effect: Effect.Effect<A, E, Credentials | HttpClient.HttpClient>,
  token: string,
  request: typeof fetch
) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    let status: number | undefined
    const observed = HttpClient.tap(client, (response) =>
      Effect.sync(() => {
        status = response.status
      })
    )
    return yield* effect.pipe(
      Effect.provideService(HttpClient.HttpClient, requireCloudflareSuccess(observed)),
      Effect.mapError(
        () =>
          new Error(
            status === undefined
              ? 'Cloudflare API request failed'
              : `Cloudflare API returned HTTP ${status} or a malformed acknowledgement`
          )
      )
    )
  }).pipe(
    none,
    Effect.provide(fromApiToken({ apiToken: Redacted.make(token) })),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, request)
  )
}
