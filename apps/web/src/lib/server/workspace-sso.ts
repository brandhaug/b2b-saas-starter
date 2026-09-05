import {
  type SsoConnection,
  type SsoRoutingDecision
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { createServerFn } from '@tanstack/react-start'

import { EMAIL_PATTERN } from '../email-pattern'
import { expectOptionalString, expectRecord, expectString } from './input-shape'

/**
 * The workspace-SSO server functions, in a **client-safe** module — the
 * `invitations.ts` pattern. The capability effects, the input schemas and
 * their imports (the session gate, the plugin binding, the IdP discovery
 * client) live in `workspace-sso.effects.ts` and are reached only through
 * dynamic `import()` inside each handler, so nothing here rides the client
 * bundle beyond the declarations and the payload types. The validators are
 * stripped the same way handler bodies are — `.validator()` runs on the
 * server only — so the plain shape checks below are the server's first
 * decode, a wire-shape gate that declares each fn's input type without
 * dragging the Effect Schema chunk onto the route tree, while the strict
 * schemas (the domain rule, the SAML metadata xor, the credential pair)
 * decode again in the effects file.
 */

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

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, a wire-shape gate, and the strict schemas — the
 * domain rule, the SAML metadata xor, the credential pair — decode again in
 * `workspace-sso.effects.ts`; these probes ARE the I/O boundary, so
 * `unknown` in and `throw` out is the contract, the same exemption
 * `pickOptionalStrings` carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error, effect/noAs, typescript/no-unsafe-type-assertion
function expectOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string
): boolean | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeCreate(input: unknown): CreateSsoConnectionInput {
  const record = expectRecord(input, 'SSO connection input')
  const protocol = expectString(record, 'protocol', 'SSO connection input')
  if (protocol !== 'oidc' && protocol !== 'saml') {
    throw new Error('Invalid SSO connection input: protocol')
  }
  const shared = {
    workspaceSlug: expectString(record, 'workspaceSlug', 'SSO connection input'),
    domain: expectString(record, 'domain', 'SSO connection input'),
    // SAFETY: the strict schema in `workspace-sso.effects.ts` re-decodes the
    // role literal before anything runs; this check only establishes the
    // wire shape for the client stub's type.
    defaultWorkspaceRole: expectString(
      record,
      'defaultWorkspaceRole',
      'SSO connection input'
    ) as CreateSsoConnectionInput['defaultWorkspaceRole']
  }
  if (protocol === 'saml') {
    return {
      ...shared,
      protocol,
      metadataXml: expectOptionalString(record, 'metadataXml', 'SSO connection input'),
      metadataUrl: expectOptionalString(record, 'metadataUrl', 'SSO connection input'),
      issuer: expectOptionalString(record, 'issuer', 'SSO connection input')
    }
  }
  return {
    ...shared,
    protocol,
    issuer: expectString(record, 'issuer', 'SSO connection input'),
    clientId: expectString(record, 'clientId', 'SSO connection input'),
    clientSecret: expectString(record, 'clientSecret', 'SSO connection input')
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeUpdate(input: unknown): UpdateSsoConnectionInput {
  const record = expectRecord(input, 'SSO connection update input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'SSO connection update input'),
    providerId: expectString(record, 'providerId', 'SSO connection update input'),
    enabled: expectOptionalBoolean(record, 'enabled', 'SSO connection update input'),
    requireSso: expectOptionalBoolean(
      record,
      'requireSso',
      'SSO connection update input'
    ),
    // SAFETY: the strict schema in `workspace-sso.effects.ts` re-decodes the
    // role literal before anything runs; this check only establishes the
    // wire shape for the client stub's type.
    defaultWorkspaceRole: expectOptionalString(
      record,
      'defaultWorkspaceRole',
      'SSO connection update input'
    ) as UpdateSsoConnectionInput['defaultWorkspaceRole'],
    clientId: expectOptionalString(record, 'clientId', 'SSO connection update input'),
    clientSecret: expectOptionalString(
      record,
      'clientSecret',
      'SSO connection update input'
    )
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeByProvider(input: unknown): RemoveSsoConnectionInput {
  const record = expectRecord(input, 'SSO provider input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'SSO provider input'),
    providerId: expectString(record, 'providerId', 'SSO provider input')
  }
}

type RoutingInput = {
  readonly email: string
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeRouting(input: unknown): RoutingInput {
  const record = expectRecord(input, 'SSO routing input')
  const email = expectString(record, 'email', 'SSO routing input')
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Invalid SSO routing input: email')
  }
  return { email }
}
// oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error, effect/noAs, typescript/no-unsafe-type-assertion

export const createSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCreate)
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

export const updateSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(decodeUpdate)
  .handler(async ({ data }): Promise<SsoConnection | null> => {
    const { updateSsoConnectionHandler } = await import('./workspace-sso.effects')
    return updateSsoConnectionHandler(data)
  })

export type RemoveSsoConnectionInput = {
  readonly workspaceSlug: string
  readonly providerId: string
}

export const removeSsoConnectionServerFn = createServerFn({ method: 'POST' })
  .validator(decodeByProvider)
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
  .validator(decodeByProvider)
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
  .validator(decodeRouting)
  .handler(async ({ data }): Promise<SsoRoutingDecision | null> => {
    const { resolveSsoRoutingHandler } = await import('./workspace-sso.effects')
    return resolveSsoRoutingHandler(data)
  })
