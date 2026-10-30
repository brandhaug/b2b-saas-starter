import { Deferred, Effect } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import { afterEach, expect, vi } from 'vite-plus/test'
import { waitFor } from '@testing-library/dom'
import * as Account from './index'
import * as Security from './security'

// Scoped replacement for the old React query/router wrappers. Uses the shipped
// parent update, view, modal resources and subscriptions, including command lifts.
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  vi.restoreAllMocks()
})

export async function renderAccount(
  children: Partial<Account.Model>,
  commands: ReadonlyArray<Command.Command<Account.Message>> = []
) {
  for (const [name, open] of [
    ['showModal', true],
    ['close', false]
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = open
      }
    })
    disposers.unshift(() => {
      if (previous) {
        Object.defineProperty(HTMLDialogElement.prototype, name, previous)
      } else {
        Reflect.deleteProperty(HTMLDialogElement.prototype, name)
      }
    })
  }
  let page: Account.Flags['data']['page'] = null
  if (children.email) {
    page = children.email.flags.recovery
      ? {
          _tag: 'account-notifications',
          data: { preferences: [] },
          deliveries: [],
          turnstileSiteKey: null
        }
      : { _tag: 'directory', turnstileSiteKey: null }
  }
  const flags: Account.Flags = {
    search: '',
    data: {
      root: null,
      session: null,
      directory: [],
      suspension: null,
      page,
      locale: 'en',
      presentation: { timeZone: 'UTC', authenticated: true, needsTimeZone: false },
      status: 200,
      error: null
    }
  }
  const initial: Account.Model = {
    flags,
    security: null,
    personal: null,
    notifications: null,
    directory: null,
    admin: null,
    email: null,
    ...children
  }
  const container = document.createElement('div')
  const mount = document.createElement('div')
  mount.id = 'account-native-test'
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature.
  container.appendChild(mount)
  document.body.insertBefore(container, null)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Account.Model,
      Model: Account.Model,
      init: (model): Update.Return<Account.Model, Account.Message> => ({
        model: Account.update(model, { _tag: 'Ready' }).model,
        commands
      }),
      update: Account.update,
      view: (model, h) => ({
        title: 'Account behavior',
        body: h.main([], [Account.view(model, h)])
      }),
      subscriptions: Account.subscriptions,
      managedResources: Account.managedResources,
      container: mount
    }),
    { flags: Effect.succeed(initial) }
  )
  disposers.unshift(() => {
    handle.dispose()
    container.remove()
  })
  await waitFor(() => expect(container.querySelector('main')).not.toBeNull())
  return container
}

export function renderSecurity(enabled = false, impersonating = false) {
  const result = Security.init('Demo Admin', enabled, impersonating)
  return renderAccount(
    { security: result.model },
    (result.commands ?? []).map((command) =>
      Command.mapMessage(command, (message): Account.Message => ({
        _tag: 'Security',
        message
      }))
    )
  )
}

export function deferred<A>() {
  const response = Effect.runSync(Deferred.make<A>())
  return {
    promise: Effect.runPromise(Deferred.await(response)),
    resolve(value: A) {
      Effect.runSync(Deferred.succeed(response, value))
    }
  }
}
