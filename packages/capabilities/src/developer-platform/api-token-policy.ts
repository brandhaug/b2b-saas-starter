import { DateTime, Effect, Schema } from 'effect'

import { ApiTokenNotRotatable, InvalidApiTokenInput } from '../errors.ts'
import { randomHex } from '@b2b-saas-starter/failure/crypto'
import {
  CreateApiTokenPayload,
  ReplaceApiTokenPayload,
  type ApiToken,
  type CreateApiTokenInput,
  type ReplaceApiTokenInput
} from './api-token-registry.ts'

const decodeCreation = Schema.decodeUnknownEffect(CreateApiTokenPayload)
const decodeReplacement = Schema.decodeUnknownEffect(ReplaceApiTokenPayload)

export function tokenIsExpired(expiresAt: string | null, now: number): boolean {
  // Invalid persisted timestamps fail closed too.
  return expiresAt !== null && !(Date.parse(expiresAt) > now)
}

export const validateTokenCreation = Effect.fn('ApiTokenRegistry.validateCreation')(
  function* (input: CreateApiTokenInput, now: number) {
    const decoded = yield* decodeCreation(input).pipe(
      Effect.mapError(
        () =>
          new InvalidApiTokenInput({
            message:
              'Provide a name, unique token scopes, and an optional ISO UTC expiry.'
          })
      )
    )
    if (decoded.expiresAt !== undefined && tokenIsExpired(decoded.expiresAt, now)) {
      return yield* Effect.fail(
        new InvalidApiTokenInput({ message: 'Expiry must be in the future.' })
      )
    }
    return decoded
  }
)

export const planTokenReplacement = Effect.fn('ApiTokenRegistry.planReplacement')(
  function* (source: ApiToken, input: ReplaceApiTokenInput, now: number) {
    if (source.replacedByTokenId !== null || tokenIsExpired(source.expiresAt, now)) {
      return yield* Effect.fail(new ApiTokenNotRotatable({ tokenId: input.tokenId }))
    }
    const decoded = yield* decodeReplacement(input).pipe(
      Effect.mapError(
        () =>
          new InvalidApiTokenInput({
            message:
              'Provide unique token scopes and an overlap between 0 and 86400 seconds.'
          })
      )
    )
    const originalScopes = new Set(source.scopes)
    if (decoded.scopes.some((scope) => !originalScopes.has(scope))) {
      return yield* Effect.fail(
        new InvalidApiTokenInput({
          message:
            'Replacement scopes must be the same as or narrower than the original token.'
        })
      )
    }
    const expiresAt = decoded.expiresAt ?? source.expiresAt
    if (
      tokenIsExpired(expiresAt, now) ||
      (source.expiresAt !== null && expiresAt !== null && expiresAt > source.expiresAt)
    ) {
      return yield* Effect.fail(
        new InvalidApiTokenInput({
          message:
            'Replacement expiry must be in the future and cannot extend the original expiry.'
        })
      )
    }
    const overlapEndsAt = DateTime.formatIso(
      DateTime.makeUnsafe(now + decoded.overlapSeconds * 1000)
    )
    let previousTokenExpiresAt = overlapEndsAt
    if (source.expiresAt !== null && source.expiresAt < overlapEndsAt) {
      previousTokenExpiresAt = source.expiresAt
    }
    return { scopes: decoded.scopes, expiresAt, previousTokenExpiresAt }
  }
)

export function mintApiToken(): string {
  return `bsk_live_${randomHex(24)}`
}
