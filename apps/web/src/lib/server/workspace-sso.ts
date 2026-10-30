import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-sso'
import { Schema } from 'effect'

import { EMAIL_PATTERN } from '../email-pattern'

const Domain = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isPattern(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i)
)

const CreateOidcInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  protocol: Schema.Literal('oidc'),
  domain: Domain,
  issuer: Schema.String.check(Schema.isMinLength(8), Schema.isPattern(/^https:\/\//)),
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  defaultWorkspaceRole: Schema.Literals(['member', 'admin'])
})

const CreateSamlInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  protocol: Schema.Literal('saml'),
  domain: Domain,
  // XML or URL: exactly one. The issuer is derived from the request origin
  // when omitted (the conventional SP entity id).
  metadataXml: Schema.optional(Schema.NonEmptyString),
  metadataUrl: Schema.optional(Schema.String.check(Schema.isPattern(/^https:\/\//))),
  issuer: Schema.optional(Schema.String),
  defaultWorkspaceRole: Schema.Literals(['member', 'admin'])
}).check(
  Schema.makeFilter((input) => {
    const hasXml = input.metadataXml !== undefined
    const hasUrl = input.metadataUrl !== undefined
    if (hasXml !== hasUrl) {
      return
    }
    return {
      path: ['metadataXml'],
      issue: 'Provide exactly one of metadataXml or metadataUrl'
    }
  })
)

const CreateSsoConnectionInput = Schema.Union([CreateOidcInput, CreateSamlInput])

export type CreateSsoConnectionInput = typeof CreateSsoConnectionInput.Type

const UpdateSsoConnectionInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  providerId: Schema.NonEmptyString,
  enabled: Schema.optional(Schema.Boolean),
  requireSso: Schema.optional(Schema.Boolean),
  defaultWorkspaceRole: Schema.optional(Schema.Literals(['member', 'admin'])),
  clientId: Schema.optional(Schema.NonEmptyString),
  clientSecret: Schema.optional(Schema.NonEmptyString)
}).check(
  Schema.makeFilter((input) => {
    // Credential rotation is both-or-neither: the plugin merges a partial
    // oidcConfig over the stored one, so a lone half would silently do
    // nothing (or worse, half-rotate). Same rule shape as the SAML create
    // filter above.
    const hasId = input.clientId !== undefined
    const hasSecret = input.clientSecret !== undefined
    if (hasId === hasSecret) {
      return
    }
    return {
      path: ['clientSecret'],
      issue: 'Rotating credentials requires both clientId and clientSecret'
    }
  })
)

export type UpdateSsoConnectionInput = typeof UpdateSsoConnectionInput.Type

const RemoveSsoConnectionInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  providerId: Schema.NonEmptyString
})

export type RemoveSsoConnectionInput = typeof RemoveSsoConnectionInput.Type

const RoutingInput = Schema.Struct({
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN)
  )
})

export type RoutingInput = typeof RoutingInput.Type

export type SsoTestResult =
  | { readonly outcome: 'passed' }
  | {
      readonly outcome: 'failed'
      readonly code: string
      readonly message: string
    }

export const Api = HttpApi.make('web-workspace-sso').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'createSsoConnectionServerFn',
      '/api/web/createSsoConnectionServerFn',
      {
        payload: CreateSsoConnectionInput,
        success: Responses.createSsoConnectionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'updateSsoConnectionServerFn',
      '/api/web/updateSsoConnectionServerFn',
      {
        payload: UpdateSsoConnectionInput,
        success: Responses.updateSsoConnectionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'removeSsoConnectionServerFn',
      '/api/web/removeSsoConnectionServerFn',
      {
        payload: RemoveSsoConnectionInput,
        success: Responses.removeSsoConnectionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'testSsoConnectionServerFn',
      '/api/web/testSsoConnectionServerFn',
      {
        payload: RemoveSsoConnectionInput,
        success: Responses.testSsoConnectionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'resolveSsoRoutingServerFn',
      '/api/web/resolveSsoRoutingServerFn',
      {
        payload: RoutingInput,
        success: Responses.resolveSsoRoutingServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const createSsoConnectionServerFn = dataCall(
  browser,
  CreateSsoConnectionInput,
  (client, payload) => client.calls.createSsoConnectionServerFn({ payload })
)

export const updateSsoConnectionServerFn = dataCall(
  browser,
  UpdateSsoConnectionInput,
  (client, payload) => client.calls.updateSsoConnectionServerFn({ payload })
)

export const removeSsoConnectionServerFn = dataCall(
  browser,
  RemoveSsoConnectionInput,
  (client, payload) => client.calls.removeSsoConnectionServerFn({ payload })
)

export const testSsoConnectionServerFn = dataCall(
  browser,
  RemoveSsoConnectionInput,
  (client, payload) => client.calls.testSsoConnectionServerFn({ payload })
)

export const resolveSsoRoutingServerFn = dataCall(
  browser,
  RoutingInput,
  (client, payload) => client.calls.resolveSsoRoutingServerFn({ payload })
)
