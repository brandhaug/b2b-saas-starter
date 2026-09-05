import {
  type ApiToken,
  type ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The API-token server functions, in a **client-safe** module.
 *
 * This file is statically imported by the tokens route and its components,
 * and the route tree ships to the browser — so everything at this module's
 * top level rides on every page. That is why the loader composition, the
 * revoke effect and their imports (the capability services, the permission
 * helpers) live in `api-tokens.effects.ts` and are reached only through
 * dynamic `import()` inside each handler: TanStack Start strips handler
 * bodies from the client build, so the capabilities graph never ships. The
 * validators are stripped the same way handler bodies are — `.validator()`
 * runs on the server only — so the plain shape checks below are the
 * server's first decode, a wire-shape gate that declares each fn's input
 * type without dragging the Effect Schema chunk onto the route tree, while
 * the strict schemas (scope literals, name bounds) decode again in the
 * effects file before anything runs.
 *
 * The behaviour itself is tested as the loader and revoke effect in the
 * effects file (`api-tokens.test.ts`), driven directly with fixture actors.
 */

/**
 * The API tokens payload.
 *
 * Unlike the members roster, reading tokens is itself a permission:
 * `apiToken:list` is withheld from a plain `member`, so the page hard-gates on
 * it — a member meeting the URL directly gets the denial, not an empty list.
 */
export type WorkspaceApiTokensPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly tokens: ReadonlyArray<ApiToken>
}

/** Input shape of `loadWorkspaceApiTokensServerFn`, for its client stub. */
type LoadApiTokensInput = {
  readonly workspaceSlug: string
}

/** Input shape of `createApiTokenServerFn`, for its client stub. */
type CreateApiTokenInput = {
  readonly workspaceSlug: string
  readonly name: string
  readonly scopes: ReadonlyArray<ApiTokenScope>
}

/** Input shape of `revokeApiTokenServerFn`, for its client stub. */
type RevokeApiTokenInput = {
  readonly workspaceSlug: string
  readonly tokenId: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, and the strict schemas — scope literals, name
 * bounds — decode again in `api-tokens.effects.ts`. `expectStrings` carries
 * the same exemption the probes in `input-shape.ts` carry: these checks ARE
 * the I/O boundary, so `unknown` in and `throw` out is the contract.
 */
// oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError
function expectStrings(
  record: Record<string, unknown>,
  key: string,
  label: string
): ReadonlyArray<string> {
  const value = record[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}
// oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeLoadInput(input: unknown): LoadApiTokensInput {
  const record = expectRecord(input, 'tokens input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'tokens input') }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeCreateInput(input: unknown): CreateApiTokenInput {
  const record = expectRecord(input, 'create-token input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'create-token input'),
    name: expectString(record, 'name', 'create-token input'),
    // SAFETY: the strict schema in `api-tokens.effects.ts` re-decodes the
    // scopes against the literal tuple before anything runs; this check only
    // establishes the wire shape for the client stub's type.
    // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- the cast only narrows string to the scope union the strict schema enforces
    scopes: expectStrings(
      record,
      'scopes',
      'create-token input'
    ) as CreateApiTokenInput['scopes']
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeRevokeInput(input: unknown): RevokeApiTokenInput {
  const record = expectRecord(input, 'revoke-token input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'revoke-token input'),
    tokenId: expectString(record, 'tokenId', 'revoke-token input')
  }
}

/** The API tokens route's loader. */
export const loadWorkspaceApiTokensServerFn = createServerFn({ method: 'GET' })
  .validator(decodeLoadInput)
  .handler(async ({ data }): Promise<WorkspaceApiTokensPayload> => {
    const { loadWorkspaceApiTokensHandler } = await import('./api-tokens.effects')
    return loadWorkspaceApiTokensHandler(data)
  })

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCreateInput)
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const { createApiTokenHandler } = await import('./api-tokens.effects')
    return createApiTokenHandler(data)
  })

export const revokeApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator(decodeRevokeInput)
  .handler(async ({ data }): Promise<boolean> => {
    const { revokeApiTokenHandler } = await import('./api-tokens.effects')
    return revokeApiTokenHandler(data)
  })
