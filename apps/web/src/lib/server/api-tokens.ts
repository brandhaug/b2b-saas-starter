import {
  type ApiToken,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { API_TOKEN_SCOPES, type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The API-token server functions, in a **client-safe** module — the
 * client-safe half of the `api-tokens.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived types below type
 * both the client stub and the effects handlers.
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

const LoadApiTokensInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  scopes: Schema.NonEmptyArray(Schema.Literals(API_TOKEN_SCOPES))
})

// The `workspaceSlug` half is the web fn's own; the capability's revoke
// input is `{ tokenId }` alone (`RevokeApiTokenRef` below).
const RevokeApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: Schema.NonEmptyString
})

export type LoadApiTokensInput = typeof LoadApiTokensInput.Type
export type CreateApiTokenInput = typeof CreateApiTokenInput.Type
export type RevokeApiTokenInput = typeof RevokeApiTokenInput.Type

/** The API tokens route's loader. */
export const loadWorkspaceApiTokensServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(LoadApiTokensInput))
  .handler(async ({ data }): Promise<WorkspaceApiTokensPayload> => {
    const { loadWorkspaceApiTokensHandler } = await import('./api-tokens.effects')
    return loadWorkspaceApiTokensHandler(data)
  })

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CreateApiTokenInput))
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const { createApiTokenHandler } = await import('./api-tokens.effects')
    return createApiTokenHandler(data)
  })

export const revokeApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RevokeApiTokenInput))
  .handler(async ({ data }): Promise<boolean> => {
    const { revokeApiTokenHandler } = await import('./api-tokens.effects')
    return revokeApiTokenHandler(data)
  })
