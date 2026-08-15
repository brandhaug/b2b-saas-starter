import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import {
  ApiTokenRegistry,
  ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

// All input constraints live in the schema — no imperative re-validation.
const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  scopes: Schema.NonEmptyArray(ApiTokenScope)
})

// The schema decoder IS the boundary contract: passing it as the validator
// keeps the untyped wire value inside `decodeUnknownSync` and hands the handler
// the decoded domain type.
const decodeInput = Schema.decodeUnknownSync(CreateApiTokenInput)

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeInput(input))
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        // The session gate above proves who is asking; this proves they may.
        yield* requireWorkspacePermission({ apiToken: ['create'] })
        const tokens = yield* ApiTokenRegistry
        return yield* tokens.create({
          name: data.name,
          scopes: data.scopes,
          actorUserId: session.user.id
        })
      }),
      { userId: session.user.id }
    )
  })
