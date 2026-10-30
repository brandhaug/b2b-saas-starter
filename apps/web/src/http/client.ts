import { Cause, Effect, Exit, Option, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { type HttpApi, HttpApiClient, type HttpApiGroup } from 'effect/http-api'
import { UiError } from '../lib/ui-error'
import { WebErrorSchema } from './errors'

const ClientLive = FetchHttpClient.layer
const decodeWebError = Schema.decodeUnknownOption(WebErrorSchema)

function clientHeaders(client: HttpClient.HttpClient): HttpClient.HttpClient {
  return HttpClient.mapRequest(
    client,
    HttpClientRequest.setHeader('x-starter-client', '1')
  )
}

/** Compile the official HTTP client once, lazily, rather than for each button press. */
export function makeBrowserClient<
  Id extends string,
  Groups extends HttpApiGroup.Constraint
>(api: HttpApi.HttpApi<Id, Groups>) {
  return Effect.runSync(
    Effect.cached(HttpApiClient.make(api, { transformClient: clientHeaders }))
  )
}

export function readCall<Client, A, E>(
  client: Effect.Effect<Client, never, HttpClient.HttpClient>,
  send: (client: Client) => Effect.Effect<A, E>
) {
  return (options?: { readonly signal?: AbortSignal }): Promise<A> =>
    runClient(Effect.flatMap(client, send), options?.signal)
}

/** The old caller signature takes encoded input. Decode it before HttpApi encodes the wire request. */
export function dataCall<Client, Input, Encoded, A, E>(
  client: Effect.Effect<Client, never, HttpClient.HttpClient>,
  input: Schema.Codec<Input, Encoded>,
  send: (client: Client, payload: Input) => Effect.Effect<A, E>
) {
  // Compiled once when this module-level client function is constructed.
  const decode = Schema.decodeUnknownEffect(input)
  return (options: {
    readonly data: Encoded
    readonly signal?: AbortSignal
  }): Promise<A> =>
    runClient(
      Effect.gen(function* () {
        const payload = yield* decode(options.data)
        return yield* send(yield* client, payload)
      }),
      options.signal
    )
}

async function runClient<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  signal?: AbortSignal
): Promise<A> {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, ClientLive), {
    signal
  })
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  if (Cause.hasInterrupts(exit.cause)) {
    // oxlint-disable-next-line effect/noThrowStatement -- keep cancellation distinguishable at the browser Promise seam
    throw new DOMException('Request cancelled', 'AbortError')
  }
  const failure = Cause.findErrorOption(exit.cause)
  const decoded = Option.isSome(failure) ? decodeWebError(failure.value) : Option.none()
  if (Option.isSome(decoded)) {
    // oxlint-disable-next-line effect/noThrowStatement -- the browser Promise contract rejects with the decoded public refusal
    throw new UiError(decoded.value.code, decoded.value.details, decoded.value.code)
  }
  // oxlint-disable-next-line effect/noThrowStatement -- network/schema failures reject without disclosing diagnostics
  throw new UiError('unavailable', {}, 'unavailable')
}
