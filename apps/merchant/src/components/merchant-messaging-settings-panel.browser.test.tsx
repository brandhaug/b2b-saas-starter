// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MerchantMessagingSettingsLoadError,
  MerchantMessagingSettingsLoading,
  MerchantMessagingSettingsPanel
} from './merchant-messaging-settings-panel.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

const settings = {
  merchantId: 'mrc_one',
  enabled: true,
  controls: {
    confirmation: 'send' as const,
    reschedule: 'send' as const,
    cancellation: 'send' as const,
    reminder: 'send' as const
  },
  reminderLeadHours: 24 as const,
  deliveryWindow: '08:00–20:00 Shop time' as const,
  state: 'ready' as const,
  frozen: false,
  previews: [
    {
      purpose: 'appointment_confirmation' as const,
      locale: 'ro' as const,
      body: 'Programarea este confirmată. Detalii: https://bsolo.ro/c/BK2048'
    },
    {
      purpose: 'appointment_confirmation' as const,
      locale: 'en' as const,
      body: 'Your appointment is confirmed. Details: https://bsolo.ro/c/BK2048'
    }
  ]
}

describe('MerchantMessagingSettingsPanel', () => {
  it('stages grouped controls and commits them only through explicit Save', async () => {
    const save = vi.fn(async (input) => ({ ...settings, ...input }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(<MerchantMessagingSettingsPanel initial={settings} save={save} />)
    )

    const dontSend = container.querySelector<HTMLInputElement>(
      'input[name="reschedule"][value="dont_send"]'
    )!
    await act(async () => dontSend.click())
    expect(save).not.toHaveBeenCalled()

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save notification settings'
    )!
    await act(async () => saveButton.click())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ rescheduleEnabled: false, reminderLeadHours: 24 })
    )
  })

  it('shows provider-neutral read-only previews and truthful configuration state', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <MerchantMessagingSettingsPanel
          initial={{ ...settings, state: 'needs_configuration' }}
          save={vi.fn()}
        />
      )
    )

    expect(container.textContent).toContain('Messaging needs configuration')
    expect(container.textContent).not.toMatch(/WhatsApp|SMSO|route|provider/i)
    const preview = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Preview confirmation'
    )!
    await act(async () => preview.click())
    expect(container.querySelector('dialog')?.textContent).toContain(
      'Programarea este confirmată'
    )
    expect(container.querySelector('textarea')).toBeNull()

    const dialog = container.querySelector('dialog')!
    await act(async () =>
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    )
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('keeps staged values and reports a failed explicit save', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <MerchantMessagingSettingsPanel
          initial={settings}
          save={vi.fn(async () => {
            throw new Error('unavailable')
          })}
        />
      )
    )
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(
          'input[name="cancellation"][value="dont_send"]'
        )
        ?.click()
    )
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Save notification settings')
        ?.click()
    )

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be saved'
    )
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="cancellation"][value="dont_send"]'
      )?.checked
    ).toBe(true)
  })

  it('renders explicit route states and keeps frozen controls usable at 390px', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<MerchantMessagingSettingsLoading />))
    expect(container.textContent).toContain('Loading notification settings')
    await act(async () => root?.render(<MerchantMessagingSettingsLoadError />))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'unavailable'
    )
    await act(async () =>
      root?.render(
        <MerchantMessagingSettingsPanel
          initial={{ ...settings, state: 'disabled', frozen: true }}
          save={vi.fn()}
        />
      )
    )
    expect(container.textContent).toContain('temporarily disabled')
    expect(container.querySelector('section')?.className).toContain('w-full')
    expect(container.querySelectorAll('input:disabled').length).toBeGreaterThan(0)
  })
})
