import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  WorkspaceMembership,
  type WorkspaceMemberBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { ForbiddenError } from './capability-error'
import { runCapabilities, runWorkspaceCapabilities } from './capabilities'
import { runWebRequestScope } from './observability'
import { requireWorkspacePermission } from './server/authorize'

// The once-per-request services find the request through `currentRequest`
// (`memoizePerRequest`'s default lookup), so that module is the one seam these
// tests steer. The holder defaults to `undefined`, which is what the
// authorization tests below already run under — outside any request.
const ambient: { request: Request | undefined } = vi.hoisted(() => ({
  request: undefined
}))

vi.mock('./request-context', () => ({
  currentRequest: () => ambient.request
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

  it('refuses a member with a message the calling form can show', async () => {
    // Server functions serialize a thrown error to `name`/`message`, so the
    // message has to carry the explanation — the tag does not survive.
    await expect(createToken('usr_dev')).rejects.toThrow(ForbiddenError)
    await expect(createToken('usr_dev')).rejects.toThrow(
      /do not have permission|not allowed/i
    )
  })
})

/**
 * Yields the membership service itself: instance identity is the observable of
 * "the capability layer was built once". The seed membership adapter is a
 * `Layer.effect` whose roster is built per layer construction (see
 * `makeSeedRoster`), so a second build is a second, visibly distinct object —
 * unlike `Layer.succeed` services, whose values are module singletons either
 * way.
 */
const membershipService = Effect.gen(function* () {
  return yield* WorkspaceMembership
})

// A binding that is never invoked — the probe only reads a service — so inert
// stubs carry exactly the type `CapabilityBindings` asks for.
const inertMemberBinding: WorkspaceMemberBinding = {
  addMember: () => Promise.resolve(),
  removeMember: () => Promise.resolve(),
  leave: () => Promise.resolve(),
  changeRole: () => Promise.resolve()
}

describe('per-request capability services', () => {
  afterEach(() => {
    ambient.request = undefined
  })

  it('builds the services once per request, reusing them across every run in it', async () => {
    const request = new Request('http://localhost/workspaces/starter-lab')
    ambient.request = request

    await runWebRequestScope({ request, handlerType: 'router' }, async () => {
      // Three runs, the shape of a page whose layout and segments each load:
      // two global runs and one workspace run must land on one build. The
      // workspace run also proves the per-call context layer still resolves
      // (`usr_demo` owns the fixture workspace) on top of the shared services.
      const globalA = await runCapabilities(membershipService)
      const globalB = await runCapabilities(membershipService)
      const workspace = await runWorkspaceCapabilities(
        'starter-lab',
        membershipService,
        { userId: 'usr_demo' }
      )
      expect(globalA).toBe(globalB)
      expect(globalA).toBe(workspace)
      return new Response(null, { status: 204 })
    })
  })

  it('builds a fresh services context for a later request', async () => {
    const first = new Request('http://localhost/workspaces/first')
    const second = new Request('http://localhost/workspaces/second')
    let fromFirst: unknown
    let fromSecond: unknown

    ambient.request = first
    await runWebRequestScope({ request: first, handlerType: 'router' }, async () => {
      fromFirst = await runCapabilities(membershipService)
      return new Response(null, { status: 204 })
    })
    ambient.request = second
    await runWebRequestScope({ request: second, handlerType: 'router' }, async () => {
      fromSecond = await runCapabilities(membershipService)
      return new Response(null, { status: 204 })
    })

    expect(fromFirst).not.toBe(fromSecond)
  })

  it('builds per call outside a request scope, as tests and scripts still do', async () => {
    ambient.request = undefined

    const a = await runCapabilities(membershipService)
    const b = await runCapabilities(membershipService)

    expect(a).not.toBe(b)
  })

  it('gives plugin bindings their own memo slot, keyed by adapter identity', async () => {
    const request = new Request('http://localhost/workspaces/starter-lab')
    ambient.request = request
    const otherMemberBinding: WorkspaceMemberBinding = {
      addMember: () => Promise.resolve(),
      removeMember: () => Promise.resolve(),
      leave: () => Promise.resolve(),
      changeRole: () => Promise.resolve()
    }

    await runWebRequestScope({ request, handlerType: 'router' }, async () => {
      const plain = await runCapabilities(membershipService)
      const bound = await runCapabilities(membershipService, {
        memberBinding: inertMemberBinding
      })
      // The same adapter object again — one slot, one build.
      const boundAgain = await runCapabilities(membershipService, {
        memberBinding: inertMemberBinding
      })
      // A different adapter object — its own slot, never the first call's.
      const boundElsewhere = await runCapabilities(membershipService, {
        memberBinding: otherMemberBinding
      })

      expect(bound).not.toBe(plain)
      expect(boundAgain).toBe(bound)
      expect(boundElsewhere).not.toBe(bound)
      return new Response(null, { status: 204 })
    })
  })
})
