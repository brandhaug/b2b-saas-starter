import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { ForbiddenError } from './capability-error'
import { runWorkspaceCapabilities } from './capabilities'
import { requireWorkspacePermission } from './server/authorize'

/**
 * The whole web enforcement path, end to end against the Seed layer: the
 * workspace context resolves the actor from the fixture members, the guard
 * decides, and the failure crosses the Effect → TanStack boundary as something
 * a form can display. `usr_martin` is the fixture owner, `usr_dev` a member.
 */
function createToken(userId: string) {
  return runWorkspaceCapabilities(
    'starter-lab',
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ apiToken: ['create'] })
      const tokens = yield* ApiTokenRegistry
      return yield* tokens.create({
        name: 'CI token',
        scopes: ['read'],
        actorUserId: userId
      })
    }),
    { userId }
  )
}

describe('runWorkspaceCapabilities authorization', () => {
  it('lets the workspace owner create a token', async () => {
    const created = await createToken('usr_martin')
    expect(created.token).toBeTruthy()
  })

  it('refuses a member with a message the calling form can show', async () => {
    // Server functions serialize a thrown error to `name`/`message`, so the
    // message has to carry the explanation — the tag does not survive.
    await expect(createToken('usr_dev')).rejects.toThrow(ForbiddenError)
    await expect(createToken('usr_dev')).rejects.toThrow(
      /do not have permission|not allowed/i
    )
  })
})
