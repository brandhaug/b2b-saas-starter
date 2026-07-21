// @vitest-environment jsdom

import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MerchantDestination } from '../navigation.tsx'
import { MobileNavigationSheet } from './mobile-navigation-sheet.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    activeProps: _activeProps,
    state: _state,
    viewTransition: _viewTransition,
    ...props
  }: {
    children: ReactNode
    to: string
    activeProps?: unknown
    state?: unknown
    viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

const destinations: readonly MerchantDestination[] = [
  { label: 'Appointments', to: '/appointments' },
  { label: 'Settings', to: '/settings' }
]

describe('MobileNavigationSheet', () => {
  beforeEach(() => {
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.setAttribute('open', '')
        }
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.removeAttribute('open')
          this.dispatchEvent(new Event('close'))
        }
      }
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens modally and handles a native cancel as one dismissal', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onDismiss = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <MobileNavigationSheet
          destinations={destinations}
          open={open}
          onRequestClose={() => {
            onDismiss()
            setOpen(false)
          }}
        />
      )
    }

    await act(async () => root.render(<Harness />))
    const dialog = container.querySelector('dialog')
    expect(dialog?.hasAttribute('open')).toBe(true)

    await act(async () => {
      dialog?.dispatchEvent(new Event('cancel', { cancelable: true }))
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(dialog?.hasAttribute('open')).toBe(false)
    await act(async () => root.unmount())
  })

  it('dismisses when the visible backdrop close target is pressed', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onDismiss = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <MobileNavigationSheet
          destinations={destinations}
          open={open}
          onRequestClose={() => {
            onDismiss()
            setOpen(false)
          }}
        />
      )
    }

    await act(async () => root.render(<Harness />))
    const closeTarget = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close merchant navigation"]'
    )
    await act(async () => closeTarget?.click())

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false)
    await act(async () => root.unmount())
  })
})
