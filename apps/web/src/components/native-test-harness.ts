import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, expect } from 'vite-plus/test'
import { fireEvent, waitFor } from '@testing-library/dom'
import { type Flags } from '@/foldkit/program'
import { Flags as AuthFlags, Model as AuthModel } from '@/foldkit/auth/model'
import { init, update } from '@/foldkit/auth/update'
import { view } from '@/foldkit/auth/view'
import { subscriptions, managedResources } from '@/foldkit/auth/resources'
import * as Support from '@/foldkit/shared/support'

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
})

/** Runs the shipped native runtime, including commands, subscriptions and DOM events. */
async function renderProgram(start: (mount: HTMLElement) => { dispose(): void }) {
  const container = document.createElement('div')
  const mount = document.createElement('div')
  mount.id = 'native-behavior-test'
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare's Element.append overload accepts response bodies, not DOM nodes.
  container.appendChild(mount)
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare's Element.append overload accepts response bodies, not DOM nodes.
  document.body.appendChild(container)
  const handle = start(mount)
  function unmount() {
    handle.dispose()
    container.remove()
  }
  disposers.push(unmount)
  await waitFor(() => {
    expect(container.querySelector('main')).not.toBeNull()
  })
  return { container, unmount }
}

export async function renderNative(page: Flags['page']) {
  const { application } = await import('@/foldkit/program')
  return renderProgram((mount) =>
    Runtime.embed(application(mount), {
      flags: Effect.succeed({
        page,
        title: 'Native behavior test',
        locale: 'en',
        canonical: null,
        analyticsToken: null,
        presentation: { timeZone: 'UTC', authenticated: false, needsTimeZone: false }
      })
    })
  )
}

export function renderAuth(
  page: AuthFlags['page'],
  overrides: Partial<AuthFlags> = {}
) {
  const flags: AuthFlags = {
    page,
    search: '',
    turnstileSiteKey: null,
    socialProviders: [],
    emailVerified: false,
    twoFactorEnabled: false,
    recovering: false,
    locale: 'en',
    authenticated: false,
    ...overrides
  }
  return renderProgram((container) =>
    Runtime.embed(
      Runtime.makeApplication({
        Flags: AuthFlags,
        Model: AuthModel,
        init,
        update,
        view: (model, h) => ({ title: 'Auth behavior test', body: view(model, h) }),
        subscriptions,
        managedResources,
        container
      }),
      { flags: Effect.succeed(flags) }
    )
  )
}

export function renderSupport(flags: Support.Flags) {
  return renderProgram((container) =>
    Runtime.embed(
      Runtime.makeApplication({
        Flags: Support.Flags,
        Model: Support.Model,
        init: Support.init,
        update: Support.update,
        view: (model, h) => ({
          title: 'Support behavior test',
          body: h.main([], [Support.view(model, h)])
        }),
        container
      }),
      { flags: Effect.succeed(flags) }
    )
  )
}

/** Native input handlers commit on the next animation frame, unlike React's act wrapper. */
export async function input(element: Element, value: string): Promise<void> {
  fireEvent.input(element, { target: { value } })
  await Effect.runPromise(
    Effect.callback<undefined>((resume) => {
      const frame = requestAnimationFrame(() => resume(Effect.succeed(undefined)))
      return Effect.sync(() => cancelAnimationFrame(frame))
    })
  )
}
