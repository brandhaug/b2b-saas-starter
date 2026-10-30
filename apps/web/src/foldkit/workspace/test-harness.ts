import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test'
import { waitFor } from '@testing-library/dom'
import * as Workspace from './index'
import { type WorkspacePage } from './model'

const disposers: Array<() => void> = []
const dialogDescriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
const animationsDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)
const hidePopoverDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'hidePopover'
)
// JSDOM does not implement native top-layer activation. Keep the application
// handlers real; browser acceptance owns focus traps, light dismissal and motion.
function activatePopover(event: Event) {
  const trigger =
    event.target instanceof Element ? event.target.closest('[popovertarget]') : null
  const id = trigger?.getAttribute('popovertarget')
  if (!id) {
    return
  }
  for (const node of document.querySelectorAll<HTMLElement>('[popover]')) {
    node.style.display =
      node.id === id && trigger?.getAttribute('popovertargetaction') !== 'hide'
        ? 'block'
        : 'none'
    const toggle = new Event('toggle')
    Object.defineProperty(toggle, 'newState', {
      value: node.style.display === 'none' ? 'closed' : 'open'
    })
    node.dispatchEvent(toggle)
  }
}
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value() {
      return []
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
    configurable: true,
    value(this: HTMLElement) {
      this.style.display = 'none'
    }
  })
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
  document.addEventListener('click', activatePopover)
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  document.removeEventListener('click', activatePopover)
  vi.restoreAllMocks()
  if (animationsDescriptor) {
    Object.defineProperty(Element.prototype, 'getAnimations', animationsDescriptor)
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
  if (hidePopoverDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', hidePopoverDescriptor)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover')
  }
  for (const method of ['showModal', 'close']) {
    const descriptor = dialogDescriptors[method]
    if (descriptor) {
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor)
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, method)
    }
  }
})

export async function renderWorkspace(
  page: WorkspacePage,
  options: {
    url?: string
    actorUserId?: string
    preview?: boolean
    model?: (model: Workspace.Model) => Workspace.Model
  } = {}
) {
  const container = document.createElement('div')
  const mount = document.createElement('div')
  mount.id = 'workspace-behavior-test'
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare Element.append overload accepts response bodies rather than DOM nodes.
  container.appendChild(mount)
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare Element.append overload accepts response bodies rather than DOM nodes.
  document.body.appendChild(container)
  const url = new URL(options.url ?? '/workspaces/starter-lab', window.location.origin)
  window.history.replaceState(null, '', url)
  const flags: Workspace.Flags = {
    page,
    url: url.href,
    slug: 'starter-lab',
    actorUserId: options.actorUserId ?? 'usr_demo',
    preview: options.preview ?? false
  }
  let ready = false
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Workspace.Flags,
      Model: Workspace.Model,
      init: (value) => {
        const initial = Workspace.init(value)
        return { ...initial, model: options.model?.(initial.model) ?? initial.model }
      },
      update: (model, message) => {
        const result = Workspace.update(model, message)
        ready = result.model.ready
        return result
      },
      view: (model, h) => ({
        title: 'Workspace behavior',
        body: h.main([], [Workspace.view(model, h)])
      }),
      subscriptions: Workspace.subscriptions,
      managedResources: Workspace.managedResources,
      container: mount
    }),
    { flags: Effect.succeed(flags) }
  )
  function unmount() {
    handle.dispose()
    container.remove()
  }
  disposers.push(unmount)
  await waitFor(() => expect(container.querySelector('main')).not.toBeNull())
  await waitFor(() => expect(ready).toBe(true))
  return { container, unmount }
}
