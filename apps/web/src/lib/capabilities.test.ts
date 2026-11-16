// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { fixtureAuthModule } from '@/test/fixture-session'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Effect } from 'effect'
import { assertType, describe, expect, it, vi } from 'vite-plus/test'
import { ForbiddenError } from './capability-error'
import { runWorkspaceCapabilities } from './capabilities'
import { requireWorkspacePermission } from './server/authorize'
import { WorkspaceChangeRejected } from '@b2b-saas-starter/capabilities/errors'
import { causeMessage } from './cause-message'
import { uiErrorAdapter } from './ui-error'
import {
  WorkspaceCaller,
  WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'

vi.mock('./server/auth', () => fixtureAuthModule({}, { userId: 'usr_martin' }))

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
    WorkspaceCaller.user(userId)
  )
}

describe('runWorkspaceCapabilities authorization', () => {
  it('emits immutable workspace and actor identity without the workspace slug', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runWorkspaceCapabilities(
        'starter-lab',
        Effect.void,
        WorkspaceCaller.user('usr_martin')
      )
      expect(output).toHaveBeenCalledTimes(1)
      const serialized = String(output.mock.calls[0]?.[0])
      expect(JSON.parse(serialized)).toMatchObject({
        annotations: {
          workspaceId: expect.any(String),
          actorUserId: 'usr_martin'
        }
      })
      expect(serialized).not.toContain('starter-lab')
    } finally {
      output.mockRestore()
    }
  })

  it('serializes a billing deletion refusal without exposing diagnostics', async () => {
    const refusal = await runWorkspaceCapabilities(
      'starter-lab',
      Effect.fail(new WorkspaceChangeRejected({ reason: 'billing_obligations' })),
      WorkspaceCaller.user('usr_martin')
    ).catch((error: unknown) => error)
    expect(refusal).toMatchObject({
      code: 'workspace_billing_obligations',
      details: {}
    })
    if (uiErrorAdapter.test(refusal)) {
      const serialized = uiErrorAdapter.toSerializable(refusal)
      expect(
        causeMessage(uiErrorAdapter.fromSerializable(serialized), 'fallback')
      ).toBe(
        'This workspace has unresolved billing activity. Review billing or contact support before deleting it.'
      )
    }
  })

  it('attributes a run with no signed-in user to the system, never to a user', async () => {
    // The public showcase read runs with no session. Its context must not
    // claim a user provenance it cannot name: audit rows read both fields.
    const context = await runWorkspaceCapabilities(
      'starter-lab',
      Effect.map(WorkspaceContext, (ctx) => ({
        actor: ctx.actor,
        actorType: ctx.actorType
      })),
      WorkspaceCaller.system
    )
    expect(context).toEqual({ actor: null, actorType: 'system' })
    // The pair that recorded `'user'` with no user before no longer compiles.
    // @ts-expect-error -- a user provenance must name its user
    assertType<WorkspaceCaller>({ actorType: 'user' })
  })

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
