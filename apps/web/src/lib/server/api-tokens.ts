import { ApiTokenId } from '@b2b-saas-starter/db/ids'
import {
  CreateApiTokenPayload,
  ReplaceApiTokenPayload,
  type ApiToken,
  type ReplacedApiToken,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

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
  ...CreateApiTokenPayload.fields
})

// The `workspaceSlug` half is the web fn's own; the capability's revoke
// input is `{ tokenId }` alone (`RevokeApiTokenRef` below).
const RevokeApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: ApiTokenId
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

const ReplaceApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: ApiTokenId,
  ...ReplaceApiTokenPayload.fields
})
export type ReplaceApiTokenInput = typeof ReplaceApiTokenInput.Type

export const replaceApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ReplaceApiTokenInput))
  .handler(async ({ data }): Promise<ReplacedApiToken> => {
    const { replaceApiTokenHandler } = await import('./api-tokens.effects')
    return replaceApiTokenHandler(data)
  })
