import { CloudflareEnvironment } from '@alchemy.run/cloudflare'
import { Stage } from 'alchemy/Stage'
import { Effect, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

export const apiUrl = 'https://api.cloudflare.com/client/v4'
export const Identifier = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u))
export const Domain = Schema.String.check(
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u)
)
export const PageInfo = Schema.Struct({
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  total_pages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export function envelope<A>(result: Schema.ConstraintDecoder<A>) {
  return Schema.Struct({ success: Schema.Literal(true), result })
}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is Effect's error-class factory.
export class EmailSendingError extends Schema.TaggedError<EmailSendingError>()(
  'EmailSendingError',
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Int)
  }
) {}

export function failure(operation: string, message: string) {
  return new EmailSendingError({ operation, message })
}
export function missing<A>(effect: Effect.Effect<A, EmailSendingError>) {
  return effect.pipe(
    Effect.catchTag('EmailSendingError', (error) =>
      error.status === 404 ? Effect.void : Effect.fail(error)
    )
  )
}
export const checkEnvironment = Effect.fn('EmailSending.checkEnvironment')(function* (
  environment: { accountId: string; stage: string },
  accountId: string
) {
  if (environment.stage !== 'prod') {
    return yield* failure('scope', 'Email Sending automation is production-only')
  }
  if (environment.accountId !== accountId) {
    return yield* failure(
      'scope',
      'Configured account differs from the authenticated account'
    )
  }
})

/** Shares Alchemy credentials without modifying permissions or persisted auth. */
export const authenticatedEmailClient = Effect.gen(function* () {
  const credentials = yield* yield* CloudflareEnvironment
  const stage = yield* Stage
  const transport = yield* HttpClient.HttpClient
  const client = HttpClient.mapRequest(transport, (request) => {
    if (credentials.type === 'apiKey') {
      return request.pipe(
        HttpClientRequest.setHeaders({
          'X-Auth-Key': Redacted.value(credentials.apiKey),
          'X-Auth-Email': Redacted.value(credentials.email)
        })
      )
    }
    return HttpClientRequest.bearerToken(
      request,
      credentials.type === 'apiToken' ? credentials.apiToken : credentials.accessToken
    )
  })
  return { accountId: credentials.accountId, stage, client }
})

export function emailApi(client: HttpClient.HttpClient) {
  const request = Effect.fn('EmailSending.request')(function* (
    input: HttpClientRequest.HttpClientRequest
  ) {
    const response = yield* client
      .execute(input)
      .pipe(
        Effect.mapError(() => failure(input.method, 'Cloudflare HTTP transport failed'))
      )
    if (response.status < 200 || response.status >= 300) {
      return yield* new EmailSendingError({
        operation: input.method,
        status: response.status,
        message: `Cloudflare ${input.method} returned HTTP ${response.status}`
      })
    }
    return response
  })
  return {
    decode<A>(
      schema: Schema.ConstraintDecoder<A>,
      input: HttpClientRequest.HttpClientRequest
    ) {
      return request(input).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        Effect.catchTag(['SchemaError', 'HttpClientError'], () =>
          Effect.fail(failure(input.method, 'Malformed Cloudflare response'))
        )
      )
    }
  }
}

const Zone = envelope(
  Schema.Struct({
    id: Identifier,
    name: Domain,
    account: Schema.Struct({ id: Identifier })
  })
)
export const validateSenderZone = Effect.fn('EmailSending.validateSenderZone')(
  function* (
    api: ReturnType<typeof emailApi>,
    props: { zoneId: string; accountId: string; domain: string }
  ) {
    const zone = yield* api.decode(
      Zone,
      HttpClientRequest.get(`${apiUrl}/zones/${props.zoneId}`)
    )
    if (zone.result.id !== props.zoneId || zone.result.account.id !== props.accountId) {
      return yield* failure(
        'scope',
        'Sending zone does not belong to the configured account'
      )
    }
    if (
      props.domain !== zone.result.name &&
      !props.domain.endsWith(`.${zone.result.name}`)
    ) {
      return yield* failure('scope', 'Sender domain is outside the configured zone')
    }
  }
)

const SenderScope = Schema.Struct({
  accountId: Identifier,
  zoneId: Identifier,
  domain: Domain
})
const decodeSenderScope = Schema.decodeEffect(SenderScope)

/** Runs during stack evaluation, before the native sender can create DNS resources. */
export const validateEmailSender = Effect.fn('EmailSending.validateEmailSender')(
  function* (input: typeof SenderScope.Type) {
    const environment = yield* authenticatedEmailClient
    yield* checkEnvironment(environment, input.accountId)
    const props = yield* decodeSenderScope(input).pipe(
      Effect.mapError(() => failure('scope', 'Invalid sender account, zone or domain'))
    )
    yield* validateSenderZone(emailApi(environment.client), props)
  }
)

export const checkPage = Effect.fn('EmailSending.checkPage')(function* (
  info: Schema.Schema.Type<typeof PageInfo>,
  requested: number
) {
  if (
    info.page !== requested ||
    info.total_pages > 1000 ||
    (requested > 1 && info.total_pages < requested)
  ) {
    return yield* failure('list', 'Invalid or excessive pagination')
  }
})
