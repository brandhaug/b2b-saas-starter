import {
  type SsoConnection,
  type SsoRoutingDecision
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { EMAIL_PATTERN } from '../email-pattern'

/**
 * The workspace-SSO server functions, in a **client-safe** module — the
 * client-safe half of the `workspace-sso.effects.ts` split; see
 * apps/web/AGENTS.md for the rule and `scripts/assert-client-boundary.mjs`
 * for the enforcement. Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived type types both the
 * client stub and the effects handler.
 */

/** A connection domain: labels, dots, hyphens — never an @ or a slash. */
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

/** Remove and test both address one connection, by provider id. */
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

export const createSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CreateSsoConnectionInput))
  .handler(async ({ data }): Promise<SsoConnection> => {
    const { createSsoConnectionHandler } = await import('./workspace-sso.effects')
    return createSsoConnectionHandler(data)
  })

export const updateSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(UpdateSsoConnectionInput))
  .handler(async ({ data }): Promise<SsoConnection | null> => {
    const { updateSsoConnectionHandler } = await import('./workspace-sso.effects')
    return updateSsoConnectionHandler(data)
  })

export const removeSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RemoveSsoConnectionInput))
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
  .validator(Schema.decodeUnknownSync(RemoveSsoConnectionInput))
  .handler(async ({ data }): Promise<SsoTestResult> => {
    const { testSsoConnectionHandler } = await import('./workspace-sso.effects')
    return testSsoConnectionHandler(data)
  })

/**
 * The sign-in page's routing ask, as a server fn: does this email's domain
 * belong to an enabled connection? See `resolveSsoRoutingHandler` in
 * `workspace-sso.effects.ts` for why it is deliberately **not** session-gated.
 */
export const resolveSsoRoutingServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RoutingInput))
  .handler(async ({ data }): Promise<SsoRoutingDecision | null> => {
    const { resolveSsoRoutingHandler } = await import('./workspace-sso.effects')
    return resolveSsoRoutingHandler(data)
  })
