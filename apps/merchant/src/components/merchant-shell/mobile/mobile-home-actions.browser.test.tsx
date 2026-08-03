// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MobileHomeActions } from './mobile-home-actions.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search: _search,
    state: _state,
    viewTransition: _viewTransition,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: unknown
    state?: unknown
    viewTransition?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ search: {}, state: {} }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
}))

let root: Root | undefined
let originalShowModal: typeof HTMLDialogElement.prototype.showModal | undefined
let originalClose: typeof HTMLDialogElement.prototype.close | undefined

beforeAll(() => {
  originalShowModal = HTMLDialogElement.prototype.showModal
  originalClose = HTMLDialogElement.prototype.close
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
      }
    }
  })
})

afterAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: originalShowModal },
    close: { configurable: true, value: originalClose }
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('MobileHomeActions booking flow', () => {
  it('opens Appointment in the document-level route sheet', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <>
          <div data-merchant-mobile-sheet-portal="true" />
          <div data-merchant-home-layer="true">
            <MobileHomeActions appointmentDate="2026-07-25" currentDate="2026-07-25" />
          </div>
        </>
      )
    )

    const add = container.querySelector<HTMLButtonElement>(
      '[data-mobile-home-action="new-appointment"]'
    )
    await act(async () => add?.click())

    const appointment = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Appointment'
    )
    await act(async () => appointment?.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)))

    const bookingSheet = container.querySelector<HTMLDialogElement>(
      '[data-mobile-new-appointment-sheet="true"]'
    )
    expect(bookingSheet?.open).toBe(true)
    expect(bookingSheet?.getAttribute('aria-label')).toBe('Book an appointment')
    expect(bookingSheet?.closest('[data-merchant-home-layer="true"]')).toBeNull()
  })
})
