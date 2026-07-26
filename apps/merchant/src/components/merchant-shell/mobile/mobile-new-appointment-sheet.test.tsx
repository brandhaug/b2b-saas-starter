import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MobileNewAppointmentSheet,
  NewAppointmentDialog
} from './mobile-new-appointment-sheet.tsx'

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ search: {}, state: {} }),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() })
}))

describe('MobileNewAppointmentSheet', () => {
  it('renders the first appointment-booking step with required fields', () => {
    const html = renderToStaticMarkup(
      <MobileNewAppointmentSheet
        open
        appointmentDate="2026-07-25"
        onRequestClose={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="Book an appointment"')
    expect(html).toContain('open=""')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('merchant-mobile-sheet-theme')
    expect(html).toContain('data-mobile-new-appointment-sheet="true"')
    expect(html).toContain('data-mobile-new-appointment-field="client"')
    expect(html).toContain('data-mobile-new-appointment-field="service"')
    expect(html).toContain('data-mobile-new-appointment-field="time"')
    expect(html).toContain('disabled="" data-mobile-new-appointment-field="time"')
    expect(html).toContain('Add appointment notes')
    expect(html).toContain('Add client notes')
    expect(html).toContain('Does not repeat')
    expect(html).toContain('Notify customer')
    expect(html).toContain('data-mobile-new-appointment-save="true"')
    expect(html).toContain('disabled=""')
  })

  it('does not mount while closed', () => {
    expect(
      renderToStaticMarkup(
        <MobileNewAppointmentSheet
          open={false}
          appointmentDate="2026-07-25"
          onRequestClose={vi.fn()}
        />
      )
    ).toBe('')
  })

  it('uses a centered desktop dialog presentation without mobile sheet chrome', () => {
    const html = renderToStaticMarkup(
      <NewAppointmentDialog
        open
        presentation="desktop"
        appointmentDate="2026-07-25"
        onRequestClose={vi.fn()}
      />
    )

    expect(html).toContain('data-new-appointment-presentation="desktop"')
    expect(html).toContain('merchant-desktop-new-appointment-dialog')
    expect(html).toContain('data-desktop-new-appointment-header="true"')
    expect(html).not.toContain('data-mobile-sheet-handle="true"')
  })
})
