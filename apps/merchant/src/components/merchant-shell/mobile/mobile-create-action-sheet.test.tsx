import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MobileCreateActionSheet } from './mobile-create-action-sheet.tsx'

describe('MobileCreateActionSheet', () => {
  it('presents the two creation intents and a separate cancel action', () => {
    const html = renderToStaticMarkup(
      <MobileCreateActionSheet open onRequestClose={vi.fn()} onSelect={vi.fn()} />
    )

    expect(html).toContain('aria-label="Add to schedule"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('open=""')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('data-mobile-create-action-sheet="true"')
    expect(html).toContain('>Appointment</button>')
    expect(html).toContain('>Block time</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).not.toContain('backdrop-blur')

    const appointmentButton =
      html.match(/<button[^>]*>Appointment<\/button>/)?.[0] ?? ''
    const blockTimeButton = html.match(/<button[^>]*>Block time<\/button>/)?.[0] ?? ''
    const blockTimeButtonClass = blockTimeButton.match(/class="([^"]+)"/)?.[1] ?? ''

    for (const action of [appointmentButton, blockTimeButton]) {
      expect(action).toContain('-webkit-appearance:none')
      expect(action).toContain('appearance:none')
      expect(action).toContain('box-shadow:none')
      expect(action).toContain('background-image:none')
    }
    expect(blockTimeButtonClass).toContain('border-t')
  })

  it('anchors the action panel to the visual viewport on installed mobile', () => {
    const css = readFileSync(
      new URL('./mobile-create-action-sheet.css', import.meta.url),
      'utf8'
    )

    expect(css).toMatch(
      /\.merchant-create-action-dialog\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s
    )
    expect(css).toMatch(/\.merchant-create-action-dialog\s*\{[^}]*z-index:\s*50;/s)
    expect(css).toMatch(
      /\.merchant-create-action-panel\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;/s
    )
  })

  it('does not mount a modal while closed', () => {
    const html = renderToStaticMarkup(
      <MobileCreateActionSheet
        open={false}
        onRequestClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(html).toBe('')
  })
})
