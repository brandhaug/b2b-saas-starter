import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect, Schema } from 'effect'
import {
  ApiTokenRegistry,
  ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'
import { createServerContext } from '../server-context'

const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ApiTokenScope)
})

const decodeInput = Schema.decodeUnknownSync(CreateApiTokenInput)

const validateInput = (input: unknown): typeof CreateApiTokenInput.Type => {
  const decoded = decodeInput(input)
  if (decoded.name.length > 80) {
    throw new Error('Token name must be 80 characters or fewer')
  }
  if (decoded.scopes.length === 0) {
    throw new Error('At least one scope is required')
  }
  return decoded
}

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => validateInput(input))
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const request = getRequest()
    const auth = createServerContext().auth()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      throw redirect({ to: '/sign-in' })
    }
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        return yield* tokens.create({
          name: data.name,
          scopes: data.scopes,
          actorUserId: session.user.id
        })
      })
    )
  })
