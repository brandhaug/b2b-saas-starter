import {
  type SsoConnection,
  type SsoRoutingDecision
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Option, Schema } from 'effect'

import { EMAIL_PATTERN } from '../email-pattern'
import { runCapabilities } from '../capabilities'

/**
 * The workspace-SSO server functions, in a **client-safe** module — the
 * `invitations.ts` pattern. The capability effects and their imports (the
 * session gate, the plugin binding, the IdP discovery client) live in
 * `workspace-sso.effects.ts` and are reached only through dynamic `import()`
 * inside each handler, so nothing here rides the client bundle beyond the
 * declarations, the payload types and the input schemas.
 */

/** A connection domain: labels, dots, hyphens — never an @ or a slash. */
const Domain = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isPattern(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i)
)

const WorkspaceSlug = Schema.NonEmptyString

const CreateOidcInput = Schema.Struct({
  workspaceSlug: WorkspaceSlug,
  protocol: Schema.Literal('oidc'),
  domain: Domain,
  issuer: Schema.String.check(Schema.isMinLength(8), Schema.isPattern(/^https:\/\//)),
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  defaultWorkspaceRole: Schema.Literals(['member', 'admin'])
})

const CreateSamlInput = Schema.Struct({
  workspaceSlug: WorkspaceSlug,
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

export type CreateSsoConnectionInput = { readonly workspaceSlug: string } & (
  | {
      readonly protocol: 'oidc'
      readonly domain: string
      readonly issuer: string
      readonly clientId: string
      readonly clientSecret: string
      readonly defaultWorkspaceRole: 'member' | 'admin'
    }
  | {
      readonly protocol: 'saml'
      readonly domain: string
      readonly metadataXml?: string | undefined
      readonly metadataUrl?: string | undefined
      readonly issuer?: string | undefined
      readonly defaultWorkspaceRole: 'member' | 'admin'
    }
)

const CreateInput = Schema.Union([CreateOidcInput, CreateSamlInput])
const decodeCreate = Schema.decodeUnknownSync(CreateInput)

export const createSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCreate(input))
  .handler(async ({ data }): Promise<SsoConnection> => {
    const { createSsoConnectionHandler } = await import('./workspace-sso.effects')
    return createSsoConnectionHandler(data)
  })

export type UpdateSsoConnectionInput = {
  workspaceSlug: string
  providerId: string
  enabled?: boolean | undefined
  requireSso?: boolean | undefined
  defaultWorkspaceRole?: 'member' | 'admin' | undefined
  clientId?: string | undefined
  clientSecret?: string | undefined
}

const UpdateInput = Schema.Struct({
  workspaceSlug: WorkspaceSlug,
  providerId: Schema.NonEmptyString,
  enabled: Schema.optional(Schema.Boolean),
  requireSso: Schema.optional(Schema.Boolean),
  defaultWorkspaceRole: Schema.optional(Schema.Literals(['member', 'admin'])),
  clientId: Schema.optional(Schema.NonEmptyString),
  clientSecret: Schema.optional(Schema.NonEmptyString)
}).check(
  Schema.makeFilter((input) => {
    if (input.clientId === undefined || input.clientSecret !== undefined) {
      return
    }
    return {
      path: ['clientSecret'],
      issue: 'Rotating credentials requires both clientId and clientSecret'
    }
  })
)
const decodeUpdate = Schema.decodeUnknownSync(UpdateInput)

export const updateSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeUpdate(input))
  .handler(async ({ data }): Promise<SsoConnection | null> => {
    const { updateSsoConnectionHandler } = await import('./workspace-sso.effects')
    return updateSsoConnectionHandler(data)
  })

export type RemoveSsoConnectionInput = {
  readonly workspaceSlug: string
  readonly providerId: string
}

const ByProviderInput = Schema.Struct({
  workspaceSlug: WorkspaceSlug,
  providerId: Schema.NonEmptyString
})
const decodeByProvider = Schema.decodeUnknownSync(ByProviderInput)

export const removeSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeByProvider(input))
  .handler(async ({ data }): Promise<boolean> => {
    const { removeSsoConnectionHandler } = await import('./workspace-sso.effects')
    return removeSsoConnectionHandler(data)
  })

/** The settings form's Test button answer: a verdict, never an error. */
export type SsoTestResult =
  | { readonly outcome: 'passed' }
  | {
      readonly outcome: 'failed'
      readonly code: string
      readonly message: string
    }

export const testSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeByProvider(input))
  .handler(async ({ data }): Promise<SsoTestResult> => {
    const { testSsoConnectionHandler } = await import('./workspace-sso.effects')
    return testSsoConnectionHandler(data)
  })

/**
 * The sign-in page's routing ask: does this email's domain belong to an
 * enabled connection? Deliberately **not** session-gated — the asker is on
 * the public sign-in page — and it discloses nothing beyond the fact that the
 * domain routes, which the IdP redirect discloses anyway.
 */
const RoutingInput = Schema.Struct({
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN)
  )
})
const decodeRouting = Schema.decodeUnknownSync(RoutingInput)

export const resolveSsoRoutingServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRouting(input))
  .handler(async ({ data }): Promise<SsoRoutingDecision | null> => {
    const { SsoConnections } =
      await import('@b2b-saas-starter/capabilities/governance/workspace-sso-connections')
    const decision = await runCapabilities(
      Effect.flatMap(SsoConnections, (sso) => sso.resolveRouting(data.email))
    )
    return Option.isSome(decision) ? decision.value : null
  })
