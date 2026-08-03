// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingButton,
  BookingField,
  BookingMerchantContent,
  BookingOverlay,
  BookingPopupSheet,
  BookingSelectableCard,
  BookingViewport,
  CalendarPresence,
  FadePresence,
  RoutePresence
} from './booking-primitives.tsx'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Booking presentation primitives', () => {
  it('exposes accessible shell, interaction, form, and merchant-fallback semantics', () => {
    render(
      <BookingViewport scrollOwner="content">
        <BookingField label="Email" name="email" error="Enter a valid email." />
        <BookingSelectableCard selected onClick={() => undefined}>
          Haircut
        </BookingSelectableCard>
        <BookingButton tone="primary">Continue</BookingButton>
        <BookingMerchantContent
          text="Signature cut"
          language="en"
          fallbackIndicator="Shown in the merchant’s original language"
        />
      </BookingViewport>
    )

    expect(screen.getByRole('main').getAttribute('data-scroll-owner')).toBe('content')
    expect(
      screen.getByRole('textbox', { name: /Email/ }).getAttribute('aria-invalid')
    ).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email.')
    expect(
      screen.getByRole('button', { name: 'Haircut' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(screen.getByText('Signature cut').getAttribute('lang')).toBe('en')
    expect(screen.getByText(/original language/i)).toBeTruthy()
  })

  it('owns overlay scroll, focus, escape dismissal, and focus restoration', () => {
    const close = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">Open language</button>
        <BookingOverlay open={false} title="Choose language" onClose={close}>
          Languages
        </BookingOverlay>
      </>
    )
    const trigger = screen.getByRole('button', { name: 'Open language' })
    trigger.focus()

    rerender(
      <>
        <button type="button">Open language</button>
        <BookingOverlay open title="Choose language" onClose={close}>
          Languages
        </BookingOverlay>
      </>
    )

    expect(
      screen.getByRole('dialog', { name: 'Choose language' }).getAttribute('data-layer')
    ).toBe('sheet')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Close dialog' })
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()

    rerender(
      <>
        <button type="button">Open language</button>
        <BookingOverlay open={false} title="Choose language" onClose={close}>
          Languages
        </BookingOverlay>
      </>
    )
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the legacy popup fade decorative and preserves trigger focus', () => {
    const close = vi.fn()
    const trigger = document.createElement('button')
    const target = document.createElement('div')
    document.body.appendChild(trigger)
    document.body.appendChild(target)
    trigger.focus()
    document.body.style.overflow = 'scroll'
    const { unmount } = render(
      <BookingPopupSheet
        target={target}
        open
        label="Booking menu"
        onClose={close}
        header={<button type="button">Close menu</button>}
      >
        Menu body
      </BookingPopupSheet>
    )

    const fade = target.children.item(0) as HTMLElement
    const popup = screen.getByRole('dialog', { name: 'Booking menu' })
    const stickyHeader = popup.firstElementChild as HTMLElement
    const headerBackground = stickyHeader.firstElementChild as HTMLElement
    const headerContent = stickyHeader.lastElementChild as HTMLElement
    expect(fade).toBeTruthy()
    expect(popup.tagName).toBe('DIV')
    expect(popup.hasAttribute('data-booking-popup-scrollable')).toBe(true)
    expect(stickyHeader.children).toHaveLength(2)
    expect(headerBackground.getAttribute('aria-hidden')).toBe('true')
    expect(headerContent.textContent).toBe('Close menu')
    expect(headerBackground.className).not.toBe(stickyHeader.className)
    expect(document.activeElement).toBe(trigger)
    expect(fade.hasAttribute('aria-hidden')).toBe(false)
    fireEvent.click(fade)
    expect(close).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('scroll')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
    target.remove()
    trigger.remove()
  })

  it('collapses presence choreography when reduced motion is requested', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    )
    render(
      <FadePresence visible>
        <p>Ready</p>
      </FadePresence>
    )
    expect(screen.getByText('Ready').parentElement?.getAttribute('data-motion')).toBe(
      'reduced'
    )
  })

  it('gives calendar and keyed route choreography distinct contracts', async () => {
    const calendar = render(
      <CalendarPresence visible>
        <p>Calendar</p>
      </CalendarPresence>
    )
    expect(screen.getByText('Calendar').parentElement?.dataset.presenceVariant).toBe(
      'calendar'
    )
    calendar.unmount()

    const route = render(
      <RoutePresence presenceKey="first" direction="forward">
        <p>First route</p>
      </RoutePresence>
    )
    expect(screen.getByText('First route').parentElement?.dataset.routeDirection).toBe(
      'forward'
    )
    route.rerender(
      <RoutePresence presenceKey="second" direction="back">
        <p>Second route</p>
      </RoutePresence>
    )
    expect(await screen.findByText('Second route')).toBeTruthy()
    expect(screen.getByText('Second route').parentElement?.dataset.routeDirection).toBe(
      'back'
    )
    await waitFor(() => expect(screen.queryByText('First route')).toBeNull())
  })
})
