import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi
} from 'effect/unstable/httpapi'
import {
  CapabilityUnavailable,
  PlatformApiToken,
  PlatformApiTokenScope,
  PlatformApiTokenStatus,
  PlatformAppointment,
  PlatformMerchant,
  PlatformProvider,
  PlatformService,
  PlatformWebhookDeliveryAttempt,
  PlatformWebhookEndpoint,
  PlatformWebhookEndpointStatus,
  AppointmentWebhookEvent
} from '@b2b-saas-starter/capabilities'

const ErrorBody = (code: string) =>
  Schema.Struct({
    error: Schema.Struct({
      code: Schema.Literal(code),
      message: Schema.String,
      traceId: Schema.String,
      details: Schema.Record(Schema.String, Schema.Unknown)
    })
  })
const tagged = <Tag extends string, Code extends string>(
  tag: Tag,
  code: Code,
  status: number
) =>
  class extends Schema.TaggedErrorClass<any>()(tag, ErrorBody(code).fields, {
    httpApiStatus: status
  }) {}
export class PlatformUnauthorized extends tagged(
  'PlatformUnauthorized',
  'unauthorized',
  401
) {}
export class PlatformInsufficientScope extends tagged(
  'PlatformInsufficientScope',
  'insufficient_scope',
  403
) {}
export class PlatformScopeEscalationDenied extends tagged(
  'PlatformScopeEscalationDenied',
  'scope_escalation_denied',
  403
) {}
export class PlatformInvalidRequest extends tagged(
  'PlatformInvalidRequest',
  'invalid_request',
  400
) {}
export class PlatformInvalidCursor extends tagged(
  'PlatformInvalidCursor',
  'invalid_cursor',
  400
) {}
export class PlatformResourceNotFound extends tagged(
  'PlatformResourceNotFound',
  'resource_not_found',
  404
) {}
export class RateLimited extends Schema.TaggedErrorClass<RateLimited>()(
  'RateLimited',
  { bucket: Schema.String },
  { httpApiStatus: 429 }
) {}

const AUTH_ERRORS = [
  PlatformUnauthorized,
  PlatformInsufficientScope,
  RateLimited,
  CapabilityUnavailable
] as const
const READ_ERRORS = [...AUTH_ERRORS, PlatformResourceNotFound] as const
const LIST_ERRORS = [
  ...AUTH_ERRORS,
  PlatformInvalidCursor,
  PlatformInvalidRequest
] as const
const CollectionPage = Schema.Struct({ nextCursor: Schema.NullOr(Schema.String) })
const TimestampQuery = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
const Page = <A extends Schema.Top>(item: A) =>
  Schema.Struct({ data: Schema.Array(item), page: CollectionPage })
const Data = <A extends Schema.Top>(item: A) => Schema.Struct({ data: item })
const ServiceParams = Schema.Struct({ serviceId: Schema.String })
const ProviderParams = Schema.Struct({ providerId: Schema.String })
const AppointmentParams = Schema.Struct({ appointmentId: Schema.String })
const TokenParams = Schema.Struct({ tokenId: Schema.String })
const WebhookParams = Schema.Struct({ endpointId: Schema.String })
const CatalogQuery = Schema.Struct({
  status: Schema.optional(
    Schema.Union([
      Schema.Literals(['active', 'inactive']),
      Schema.Array(Schema.Literals(['active', 'inactive']))
    ])
  ),
  providerId: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
  serviceId: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
  updatedAtFrom: Schema.optional(TimestampQuery),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString)
})
const AppointmentQuery = Schema.Struct({
  status: Schema.optional(
    Schema.Union([
      Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
      Schema.Array(Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']))
    ])
  ),
  providerId: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
  startsAtFrom: Schema.optional(TimestampQuery),
  startsAtBefore: Schema.optional(TimestampQuery),
  updatedAtFrom: Schema.optional(TimestampQuery),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString)
})

export const HealthApi = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('check', '/health', {
    success: Schema.Struct({ status: Schema.Literal('ok') })
  })
)
export const MerchantApi = HttpApiGroup.make('merchant').add(
  HttpApiEndpoint.get('get', '/v1/merchant', {
    success: Data(PlatformMerchant),
    error: AUTH_ERRORS
  })
)
export const ServicesApi = HttpApiGroup.make('services')
  .add(
    HttpApiEndpoint.get('list', '/v1/services', {
      query: CatalogQuery,
      success: Page(PlatformService),
      error: LIST_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/v1/services/:serviceId', {
      params: ServiceParams,
      success: Data(PlatformService),
      error: READ_ERRORS
    })
  )
export const ProvidersApi = HttpApiGroup.make('providers')
  .add(
    HttpApiEndpoint.get('list', '/v1/providers', {
      query: CatalogQuery,
      success: Page(PlatformProvider),
      error: LIST_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/v1/providers/:providerId', {
      params: ProviderParams,
      success: Data(PlatformProvider),
      error: READ_ERRORS
    })
  )
export const AppointmentsApi = HttpApiGroup.make('appointments')
  .add(
    HttpApiEndpoint.get('list', '/v1/appointments', {
      query: AppointmentQuery,
      success: Page(PlatformAppointment),
      error: LIST_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/v1/appointments/:appointmentId', {
      params: AppointmentParams,
      success: Data(PlatformAppointment),
      error: READ_ERRORS
    })
  )

const TokenQuery = Schema.Struct({
  status: Schema.optional(Schema.Array(PlatformApiTokenStatus)),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString)
})
const TokenCreate = Schema.Struct({
  name: Schema.String,
  scopes: Schema.Array(PlatformApiTokenScope),
  expiresAt: Schema.NullOr(Schema.String)
})
const CreatedToken = Schema.Struct({ ...PlatformApiToken.fields, token: Schema.String })
const TOKEN_ERRORS = [
  ...AUTH_ERRORS,
  PlatformScopeEscalationDenied,
  PlatformInvalidRequest
] as const
export const PlatformApiTokenApi = HttpApiGroup.make('platform-api-tokens')
  .add(
    HttpApiEndpoint.get('list', '/v1/api-tokens', {
      query: TokenQuery,
      success: Page(PlatformApiToken),
      error: TOKEN_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post('create', '/v1/api-tokens', {
      payload: TokenCreate,
      success: CreatedToken.pipe(HttpApiSchema.status(201)),
      error: TOKEN_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.delete('revoke', '/v1/api-tokens/:tokenId', {
      params: TokenParams,
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: TOKEN_ERRORS
    })
  )

const WebhookQuery = Schema.Struct({
  status: Schema.optional(
    Schema.Union([
      PlatformWebhookEndpointStatus,
      Schema.Array(PlatformWebhookEndpointStatus)
    ])
  ),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString)
})
const WebhookPayload = Schema.Struct({
  url: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  events: Schema.Array(AppointmentWebhookEvent)
})
const WebhookPatch = Schema.Struct({
  url: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  events: Schema.optional(Schema.Array(AppointmentWebhookEvent))
})
const DeliveryQuery = Schema.Struct({
  status: Schema.optional(
    Schema.Union([
      Schema.Literals(['pending', 'delivered', 'failed', 'exhausted']),
      Schema.Array(Schema.Literals(['pending', 'delivered', 'failed', 'exhausted']))
    ])
  ),
  event: Schema.optional(
    Schema.Union([AppointmentWebhookEvent, Schema.Array(AppointmentWebhookEvent)])
  ),
  attemptedAtFrom: Schema.optional(TimestampQuery),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString)
})
const WEBHOOK_ERRORS = [
  ...AUTH_ERRORS,
  PlatformInvalidRequest,
  PlatformInvalidCursor,
  PlatformResourceNotFound
] as const
export const PlatformWebhookApi = HttpApiGroup.make('platform-webhooks')
  .add(
    HttpApiEndpoint.get('list', '/v1/webhook-endpoints', {
      query: WebhookQuery,
      success: Page(PlatformWebhookEndpoint),
      error: WEBHOOK_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post('create', '/v1/webhook-endpoints', {
      payload: WebhookPayload,
      success: Schema.Struct({
        data: PlatformWebhookEndpoint,
        signingSecret: Schema.String
      }).pipe(HttpApiSchema.status(201)),
      error: WEBHOOK_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.patch('patch', '/v1/webhook-endpoints/:endpointId', {
      params: WebhookParams,
      payload: WebhookPatch,
      success: Data(PlatformWebhookEndpoint),
      error: WEBHOOK_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.delete('disable', '/v1/webhook-endpoints/:endpointId', {
      params: WebhookParams,
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: WEBHOOK_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.post('rotate', '/v1/webhook-endpoints/:endpointId/rotate-secret', {
      params: WebhookParams,
      success: Schema.Struct({ signingSecret: Schema.String }),
      error: WEBHOOK_ERRORS
    })
  )
  .add(
    HttpApiEndpoint.get('deliveries', '/v1/webhook-endpoints/:endpointId/deliveries', {
      params: WebhookParams,
      query: DeliveryQuery,
      success: Page(PlatformWebhookDeliveryAttempt),
      error: WEBHOOK_ERRORS
    })
  )

export const StarterApi = HttpApi.make('booking-product-platform-api')
  .add(HealthApi)
  .add(MerchantApi)
  .add(ServicesApi)
  .add(ProvidersApi)
  .add(AppointmentsApi)
  .add(PlatformApiTokenApi)
  .add(PlatformWebhookApi)
  .annotateMerge(
    OpenApi.annotations({
      title: 'Booking Product Platform API',
      version: '1.0.0',
      description:
        'Merchant-scoped, read-only booking data and developer configuration.',
      servers: [{ url: '/', description: 'This worker' }]
    })
  )
