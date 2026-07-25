// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNewAppointmentSheet } from './mobile-new-appointment-sheet.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ search: {}, state: {} }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
}))

let root: Root | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('MobileNewAppointmentSheet interaction', () => {
  it('lets the merchant toggle customer notifications', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={vi.fn()} />)
    )

    const notify = container.querySelector<HTMLButtonElement>(
      '[data-mobile-new-appointment-notify="true"]'
    )
    expect(notify?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => notify?.click())
    expect(notify?.getAttribute('aria-pressed')).toBe('false')
  })

  it('routes native cancellation through the spring close lifecycle', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const onRequestClose = vi.fn()

    await act(async () =>
      root?.render(<MobileNewAppointmentSheet open onRequestClose={onRequestClose} />)
    )

    const dialog = container.querySelector<HTMLDialogElement>(
      '[data-mobile-new-appointment-sheet="true"]'
    )
    const cancel = new Event('cancel', { bubbles: false, cancelable: true })
    await act(async () => dialog?.dispatchEvent(cancel))

    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog?.dataset.mobileSheetState).toBe('closing')
    expect(onRequestClose).not.toHaveBeenCalled()

    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)))
    expect(onRequestClose).toHaveBeenCalledOnce()
  })
})
