import { CloudflareEnvironment } from '@alchemy.run/cloudflare'
import {
  Credentials,
  formatHeaders,
  apiTokenCredentials,
  apiKeyCredentials,
  oauthCredentials
} from '@distilled.cloud/cloudflare/Credentials'
import { none } from '@distilled.cloud/cloudflare/Retry'
import { getZone } from '@distilled.cloud/cloudflare/zones'
import { Stage } from 'alchemy/Stage'
import { Effect, Match, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { requireCloudflareSuccess } from '../../scripts/lib/cloudflare.ts'

export const apiUrl = 'https://api.cloudflare.com/client/v4'
export const Identifier = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u))
export const Domain = Schema.String.check(
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u)
)
export const PageInfo = Schema.Struct({
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  total_pages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
const decodePageInfo = Schema.decodeEffect(PageInfo)

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
  const environment = yield* yield* CloudflareEnvironment
  const credentials = Match.value(environment).pipe(
    Match.when({ type: 'apiKey' }, (value) =>
      apiKeyCredentials({ apiKey: value.apiKey, email: Redacted.value(value.email) })
    ),
    Match.when({ type: 'apiToken' }, (value) =>
      apiTokenCredentials({ apiToken: value.apiToken })
    ),
    Match.when({ type: 'oauth' }, (value) =>
      oauthCredentials({ accessToken: value.accessToken })
    ),
    Match.exhaustive
  )
  const stage = yield* Stage
  const transport = yield* HttpClient.HttpClient
  const client = HttpClient.mapRequest(
    transport,
    HttpClientRequest.setHeaders(formatHeaders(credentials))
  )
  return { accountId: environment.accountId, stage, client }
})

/** Capture provider services; retain sanitized errors and exact HTTP missing semantics. */
export const emailOperations = Effect.gen(function* () {
  const credentials = yield* Credentials
  const client = yield* HttpClient.HttpClient
  return <A, E>(
    operation: string,
    effect: Effect.Effect<A, E, Credentials | HttpClient.HttpClient>
  ) =>
    Effect.gen(function* () {
      let status: number | undefined
      const observedClient = HttpClient.tap(client, (response) =>
        Effect.sync(() => {
          status = response.status
        })
      )
      return yield* effect.pipe(
        none,
        Effect.provideService(Credentials, credentials),
        Effect.provideService(
          HttpClient.HttpClient,
          requireCloudflareSuccess(observedClient)
        ),
        Effect.mapError(() => {
          const details = {
            operation,
            message:
              status !== undefined && (status < 200 || status >= 300)
                ? `Cloudflare ${operation} returned HTTP ${status}`
                : 'Malformed Cloudflare response or transport failure'
          }
          return new EmailSendingError(
            status === undefined ? details : { ...details, status }
          )
        })
      )
    })
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

const decodeZone = Schema.decodeUnknownEffect(
  Schema.Struct({
    id: Identifier,
    name: Domain,
    account: Schema.Struct({ id: Identifier })
  })
)
export const validateSenderZone = Effect.fn('EmailSending.validateSenderZone')(
  function* (
    run: Effect.Success<typeof emailOperations>,
    props: { zoneId: string; accountId: string; domain: string }
  ) {
    const zone = yield* run('GET', getZone({ zoneId: props.zoneId })).pipe(
      Effect.flatMap(decodeZone),
      Effect.catchTag('SchemaError', () =>
        Effect.fail(failure('GET', 'Malformed Cloudflare zone'))
      )
    )
    if (zone.id !== props.zoneId || zone.account.id !== props.accountId) {
      return yield* failure(
        'scope',
        'Sending zone does not belong to the configured account'
      )
    }
    if (props.domain !== zone.name && !props.domain.endsWith(`.${zone.name}`)) {
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
    yield* validateSenderZone(yield* emailOperations, props)
  }
)

export const checkPage = Effect.fn('EmailSending.checkPage')(function* (
  info: Schema.Schema.Type<typeof PageInfo>,
  requested: number
) {
  yield* decodePageInfo(info).pipe(
    Effect.mapError(() => failure('list', 'Invalid pagination'))
  )
  if (
    info.page !== requested ||
    info.total_pages > 1000 ||
    (requested > 1 && info.total_pages < requested)
  ) {
    return yield* failure('list', 'Invalid or excessive pagination')
  }
})
