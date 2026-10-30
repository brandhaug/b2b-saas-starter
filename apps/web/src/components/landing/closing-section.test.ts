/* oxlint-disable unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature. */
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import * as Home from '@/foldkit/public/home'
import { COPY_COMMAND } from '@/lib/toolchain'

// Retain exact command text, denial/unavailable feedback, subscription disposal
// and late clipboard completion after runtime disposal.
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  vi.restoreAllMocks()
})
function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined
  })
}
async function renderClosing() {
  const messages: Array<Home.Message> = []
  const container = document.createElement('div'),
    mount = document.createElement('div')
  mount.id = 'closing-test'
  container.appendChild(mount)
  document.body.appendChild(container)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Home.Flags,
      Model: Home.Model,
      init: Home.init,
      update: (model, message) => {
        messages.push(message)
        return Home.update(model, message)
      },
      view: (model, h) => ({ title: 'Home', body: Home.view(model, h) }),
      // Copy lifecycle is independent of canvas and trace intersection observers.
      subscriptions: { copyReset: Home.subscriptions.copyReset },
      container: mount
    }),
    { flags: Effect.succeed({ demo: null, recentDocs: [] }) }
  )
  function unmount() {
    handle.dispose()
    container.remove()
  }
  disposers.push(unmount)
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Copy the clone and quickstart commands'
      }).disabled
    ).toBe(false)
  )
  return { unmount, container, messages }
}
function copy() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy the clone and quickstart commands' })
  )
}

it('copies the complete clone and quickstart sequence', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  clipboard(writeText)
  await renderClosing()
  copy()
  await screen.findByText('Copied')
  expect(writeText).toHaveBeenCalledWith(COPY_COMMAND)
})

it.each(['denied clipboard access', 'unavailable clipboard'])(
  'reports %s without claiming success',
  async (reason) => {
    clipboard(
      reason === 'unavailable clipboard'
        ? undefined
        : vi.fn().mockRejectedValue(new Error('Denied'))
    )
    await renderClosing()
    copy()
    await screen.findByText(
      'Could not copy commands. Allow clipboard access and try again.'
    )
    expect(screen.queryByText('Copied')).toBeNull()
  }
)

it('clears the feedback timer and ignores a late clipboard result on unmount', async () => {
  clipboard(vi.fn().mockResolvedValue(undefined))
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  const schedule = vi.spyOn(globalThis, 'setTimeout')
  const first = await renderClosing()
  copy()
  await screen.findByText('Copied')
  const timerIndex = schedule.mock.calls.findIndex((args) => args[1] === 2000)
  expect(timerIndex).toBeGreaterThanOrEqual(0)
  const timer = schedule.mock.results[timerIndex]?.value
  clear.mockClear()
  first.unmount()
  await waitFor(() => expect(clear).toHaveBeenCalledWith(timer))
  let finish: (() => void) | undefined
  const pendingCopy = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  clipboard(pendingCopy)
  const second = await renderClosing()
  copy()
  await waitFor(() => expect(pendingCopy).toHaveBeenCalledTimes(1))
  second.unmount()
  finish?.()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  expect(second.messages.some((message) => message._tag === 'Copied')).toBe(false)
  expect(screen.queryByText('Copied')).toBeNull()
})
