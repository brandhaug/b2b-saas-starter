import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import {
  ApiTokenRegistry,
  ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'

// All input constraints live in the schema — no imperative re-validation.
const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  scopes: Schema.NonEmptyArray(ApiTokenScope)
})

const decodeInput = Schema.decodeUnknownSync(CreateApiTokenInput)

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeInput(input))
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
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
