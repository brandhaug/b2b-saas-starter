/* oxlint-disable unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature. */
import { Effect, Schema } from 'effect'
import { Command, Runtime } from 'foldkit'
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { call } from '@/foldkit/server-call'
import { UiError } from '@/lib/ui-error'
import { unwrapAuthResult } from '@/lib/auth-result'
import { navigateDocument } from '@/lib/document-navigation'

vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  vi.clearAllMocks()
})
// Both server and direct-auth refusals use the shipped native transport policy.
// Returning never replays a mutation; only a second user event may do so.
async function renderAction(run: () => Promise<void>, path: string) {
  window.history.replaceState(null, '', path)
  const Run = Command.define('SharedActionTest.Run', {
    messages: [Schema.TaggedStruct('Settled', {})],
    execute: call(run, 'Action failed').pipe(
      Effect.match({
        onSuccess: () => ({ _tag: 'Settled' as const }),
        onFailure: () => ({ _tag: 'Settled' as const })
      })
    )
  })
  const container = document.createElement('div'),
    mount = document.createElement('div')
  mount.id = 'action-test'
  container.appendChild(mount)
  document.body.appendChild(container)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Schema.Null,
      Model: Schema.Boolean,
      init: () => ({ model: false }),
      update: (model, message: { _tag: 'Run' | 'Settled' }) =>
        message._tag === 'Run' ? { model: true, commands: [Run()] } : { model: false },
      view: (pending, h) => ({
        title: 'Action',
        body: h.button(
          [h.Disabled(pending), h.OnClick({ _tag: 'Run' })],
          ['Delete workspace']
        )
      }),
      container: mount
    }),
    { flags: Effect.succeed(null) }
  )
  disposers.push(() => {
    handle.dispose()
    container.remove()
  })
  await screen.findByRole('button', { name: 'Delete workspace' })
}

it('returns a denied action to verification and requires a deliberate retry after returning', async () => {
  const run = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new UiError('strong_authentication_required', {}, 'verify'))
    .mockResolvedValue(undefined)
  await renderAction(run, '/workspaces/starter-lab/settings')
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() =>
    expect(navigateDocument).toHaveBeenCalledWith(
      '/verify-authentication?recent=true&redirect=%2Fworkspaces%2Fstarter-lab%2Fsettings'
    )
  )
  window.history.replaceState(null, '', '/workspaces/starter-lab/settings')
  fireEvent.popState(window)
  expect(run).toHaveBeenCalledTimes(1)
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false)
  )
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
})

it('handles the direct auth management refusal through the same return flow', async () => {
  await renderAction(async () => {
    await unwrapAuthResult(
      async () => ({ error: { code: 'strong_authentication_required' } }),
      'Failed'
    )
  }, '/account')
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() =>
    expect(navigateDocument).toHaveBeenCalledWith(
      '/verify-authentication?recent=true&redirect=%2Faccount'
    )
  )
})
