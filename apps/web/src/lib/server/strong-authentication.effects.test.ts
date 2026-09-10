import { describe, expect, it, vi } from 'vite-plus/test'

import { runWebRequestScope } from '@/lib/observability'
import { strongAuthenticationStatusFor } from './strong-authentication.effects'

// The memo slots hang off the ambient request, which Vitest does not provide;
// only the lookup is replaced, so the real scope and the real slots stay in
// play (the same seam `observability.test.ts` uses).
const ambient: { request: Request | undefined } = vi.hoisted(() => ({
  request: undefined
}))

vi.mock('@/lib/request-context', () => ({ currentRequest: () => ambient.request }))

/**
 * The evidence read is three D1 selects on the Live adapter, and one
 * navigation asks for it twice: the workspace subtree's gate in `beforeLoad`
 * and the page's own permission check. One promise per (request, session) is
 * the proof that the second caller joined the first read instead of starting
 * another — the read itself lives inside the memoized thunk, so a shared
 * promise is a single visit to the store.
 */
describe('strongAuthenticationStatusFor', () => {
  it('reads the evidence once per request, per session', async () => {
    const request = new Request('http://localhost/workspaces/starter-lab')
    ambient.request = request

    await runWebRequestScope({ request, handlerType: 'router' }, async () => {
      const gate = strongAuthenticationStatusFor({
        userId: 'usr_demo',
        sessionId: 'ses_1'
      })
      const page = strongAuthenticationStatusFor({
        userId: 'usr_demo',
        sessionId: 'ses_1'
      })
      expect(page).toBe(gate)
      // A second device is a second session, and its own evidence.
      const otherDevice = strongAuthenticationStatusFor({
        userId: 'usr_demo',
        sessionId: 'ses_2'
      })
      expect(otherDevice).not.toBe(gate)
      await Promise.all([gate, page, otherDevice])
      return new Response(null, { status: 204 })
    })
  })

  it('reads again in the next request, so a verification is never masked', async () => {
    const reads: Array<Promise<unknown>> = []
    for (const path of ['/workspaces/starter-lab', '/workspaces/starter-lab/audit']) {
      const request = new Request(`http://localhost${path}`)
      ambient.request = request
      await runWebRequestScope({ request, handlerType: 'router' }, async () => {
        const read = strongAuthenticationStatusFor({
          userId: 'usr_demo',
          sessionId: 'ses_1'
        })
        reads.push(read)
        await read
        return new Response(null, { status: 204 })
      })
    }
    expect(reads[0]).not.toBe(reads[1])
  })
})
