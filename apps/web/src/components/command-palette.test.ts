/* oxlint-disable unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature. */
import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, afterEach, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import * as Shell from '@/foldkit/shared/application-shell'
import { input } from './native-test-harness'
import { type PageData } from '@/http/page-contract'
import { demoFixtures } from '@/lib/demo-fixtures'

// Preserve permission gates, first-action ordering, invitation URL, email lookup.
let dispose: (() => void) | undefined
const descriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true
      }
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false
      }
    }
  })
})
afterEach(() => {
  dispose?.()
  for (const key of ['showModal', 'close']) {
    const descriptor = descriptors[key]
    if (descriptor) {
      Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, key)
    }
  }
})
async function renderPalette(role: 'member' | 'owner', systemRole = 'user') {
  const data: PageData = {
    root: null,
    session: {
      user: {
        id: 'usr_demo',
        name: 'Demo',
        email: 'demo@example.com',
        emailVerified: true,
        role: systemRole,
        twoFactorEnabled: false
      },
      impersonatedBy: null
    },
    directory: [
      {
        workspace: {
          id: 'org_demo',
          slug: 'starter-lab',
          name: 'Starter Lab',
          planId: 'starter'
        },
        memberCount: 2,
        notificationCount: 0
      }
    ],
    suspension: null,
    page: { _tag: 'members', data: { ...demoFixtures.members, viewer: { role } } },
    locale: 'en',
    presentation: { timeZone: 'UTC', authenticated: true, needsTimeZone: false },
    status: 200,
    error: null
  }
  const flags = Shell.flagsForPage(
    new URL('/workspaces/starter-lab', window.location.origin),
    data
  )
  const container = document.createElement('div')
  const mount = document.createElement('div')
  mount.id = 'command-palette-test'
  container.appendChild(mount)
  document.body.appendChild(container)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Shell.Flags,
      Model: Shell.Model,
      init: Shell.init,
      update: Shell.update,
      view: (model, h) => ({
        title: 'Commands',
        body: Shell.view(model, h, h.p([], ['Content']))
      }),
      subscriptions: Shell.subscriptions,
      managedResources: Shell.managedResources,
      container: mount
    }),
    { flags: Effect.succeed(flags) }
  )
  dispose = () => {
    handle.dispose()
    container.remove()
  }
  await waitFor(() =>
    expect(
      screen.getAllByRole<HTMLButtonElement>('button', { name: 'Search' })[0]?.disabled
    ).toBe(false)
  )
}
async function open() {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  return within(await screen.findByRole('dialog', { name: 'Command menu' }))
}

it('offers owner and system-admin destinations on the first open', async () => {
  await renderPalette('owner', 'admin')
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!)
  const palette = within(await screen.findByRole('dialog', { name: 'Command menu' }))
  expect(palette.getByRole('option', { name: 'API tokens' })).toBeDefined()
  expect(palette.getByRole('option', { name: 'System admin' })).toBeDefined()
})

it('limits a member keyboard search to permitted destinations', async () => {
  await renderPalette('member')
  const palette = await open()
  expect(palette.getByRole('option', { name: 'Overview' })).toBeDefined()
  expect(palette.queryByRole('option', { name: 'API tokens' })).toBeNull()
  expect(palette.queryByRole('option', { name: 'System admin' })).toBeNull()
})

it('opens an invitation directly and lists workspace actions first', async () => {
  await renderPalette('owner')
  const palette = await open()
  const invite = palette.getByRole('option', { name: 'Invite a member' })
  expect(palette.getAllByRole('option')[0]).toBe(invite)
  expect(invite.getAttribute('href')).toBe(
    '/workspaces/starter-lab/members?action=invite'
  )
})

it('looks up members using the entered email without offering forbidden mutations', async () => {
  await renderPalette('member')
  const palette = await open()
  expect(palette.queryByRole('option', { name: 'Invite a member' })).toBeNull()
  await input(palette.getByRole('combobox'), 'ops@example.com')
  const result = await palette.findByRole('option', {
    name: 'Find members matching "ops@example.com"'
  })
  expect(result.getAttribute('href')).toBe(
    '/workspaces/starter-lab/members?query=ops%40example.com'
  )
})
