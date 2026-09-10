// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { fixtureSession } from '@/test/fixture-session'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'
import { ForbiddenError } from './capability-error'
import { runWorkspaceCapabilities } from './capabilities'
import { requireWorkspacePermission } from './server/authorize'

vi.mock('./server/auth', () => ({
  requireRequestSession: async () => fixtureSession({ userId: 'usr_martin' })
}))

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
        scopes: ['read']
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

  it('refuses a member with a code the calling form can translate', async () => {
    // `uiErrorAdapter` serializes code, allowlisted details and name — never
    // the message — so the refusal has to carry its explanation as data the
    // receiving locale words itself.
    await expect(createToken('usr_dev')).rejects.toThrow(ForbiddenError)
    await expect(createToken('usr_dev')).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'denied' }
    })
  })
})
