import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const stylesUrl = new URL('./index.css', import.meta.url)
const pokeAtmosphereAssets = [
  'poke-morning-sky.jpg',
  'poke-afternoon-sky.jpg',
  'poke-evening-sky.jpg',
  'poke-night-sky.jpg',
  'poke-beach-morning.jpeg',
  'poke-beach-afternoon.jpeg',
  'poke-beach-evening.jpeg',
  'poke-beach-night.jpeg',
  'poke-noise.png'
].map((asset) => new URL(`../public/brand/backgrounds/poke/${asset}`, import.meta.url))

function cssSection(css: string, start: string, end: string) {
  const startIndex = css.indexOf(start)
  return css.slice(startIndex, css.indexOf(end, startIndex + start.length))
}

describe('merchant BeeSolo brand contract', () => {
  it('uses the canonical honey primary with black foreground in both themes', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain('--primary: oklch(0.9 0.1739 96.8561)')
    expect(css.match(/--primary-foreground: oklch\(0 0 0\)/g)).toHaveLength(2)
  })

  it('keeps presentation classes independent from color tokens', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const mobilePresentation = css.match(/\.merchant-mobile\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(mobilePresentation).not.toContain('--primary:')
    expect(mobilePresentation).not.toContain('--background:')
    expect(mobilePresentation).not.toContain('color-scheme:')
  })

  it('restores semantic surface colors inside mobile sheets', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const sheetTheme =
      css.match(/\.merchant-mobile-sheet-theme\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(sheetTheme).toContain('--foreground: var(--merchant-surface-foreground)')
    expect(sheetTheme).toContain(
      '--muted-foreground: var(--merchant-surface-muted-foreground)'
    )
    expect(sheetTheme).toContain('--card: var(--merchant-surface-card)')
    expect(sheetTheme).toContain('--border: var(--merchant-surface-border)')
  })

  it('keeps the mobile recurrence picker compact and content-driven', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const recurrenceDialog =
      css.match(
        /dialog\[aria-labelledby='appointment-recurrence-title'\]\s*\{([^}]*)\}/
      )?.[1] ?? ''

    expect(recurrenceDialog).toContain('height: auto')
    expect(recurrenceDialog).toContain('max-height: min(36rem, calc(100% - 1rem))')
  })

  it('presents recurrence options as a centered native-feeling wheel', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const wheel =
      css.match(/\[data-mobile-recurrence-wheel='true'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    const wheelRows =
      css.match(
        /\[data-mobile-recurrence-wheel='true'\]\s*>\s*label\s*\{([^}]*)\}/
      )?.[1] ?? ''

    expect(wheel).toContain('touch-action: pan-y')
    expect(wheel).toContain('--merchant-recurrence-row-height: 4.5rem')
    expect(wheel).toContain('black 22%')
    expect(wheel).toContain('black 78%')
    expect(wheelRows).toContain('background: transparent')
    expect(wheelRows).toContain('transition-duration: 90ms')
  })

  it('keeps the desktop appointment composer aligned with the Poke dialog shell', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const dialogRule =
      css.match(
        /\.merchant-desktop-modal,\s*dialog\.merchant-desktop-new-appointment-dialog\.merchant-route-sheet,\s*dialog\.merchant-desktop-new-appointment-sidecar\s*\{([^}]*)\}/
      )?.[1] ?? ''
    const backdropRule =
      css.match(
        /\.merchant-desktop-modal::backdrop,\s*dialog\.merchant-desktop-new-appointment-dialog::backdrop\s*\{([^}]*)\}/
      )?.[1] ?? ''

    expect(dialogRule).toContain('width: min(32rem, calc(100vw - 2rem))')
    expect(dialogRule).toContain('height: min(47rem, calc(100dvh - 2rem))')
    expect(dialogRule).toContain('border-radius: 1.5rem')
    expect(backdropRule).toContain('background: transparent')
    expect(backdropRule).toContain('backdrop-filter: blur(4px)')
    expect(css).toContain('animation: merchant-desktop-modal-enter 200ms ease-out both')

    const sidecarRule =
      [
        ...css.matchAll(
          /dialog\.merchant-desktop-new-appointment-sidecar\s*\{([^}]*)\}/g
        )
      ]
        .map((match) => match[1] ?? '')
        .find((rule) => rule.includes('transform: translate3d(0.9375rem, -50%, 0)')) ??
      ''
    const sidecarBackdropRule =
      css.match(
        /dialog\.merchant-desktop-new-appointment-sidecar::backdrop\s*\{([^}]*)\}/
      )?.[1] ?? ''

    expect(sidecarRule).toContain('left: 50%')
    expect(sidecarRule).toContain('height: min(47rem, calc(100dvh + 2rem))')
    expect(sidecarRule).toContain('transform: translate3d(0.9375rem, -50%, 0)')
    expect(sidecarBackdropRule).toContain('background: transparent')
    expect(sidecarBackdropRule).toContain('backdrop-filter: none')
    expect(css).toMatch(
      /animation:\s*merchant-desktop-sidecar-enter 500ms var\(--merchant-desktop-sidecar-spring\)\s*both/
    )
    expect(css).toContain(
      'transition: transform 500ms var(--merchant-desktop-primary-spring)'
    )
    const primarySpring =
      css.match(/--merchant-desktop-primary-spring:\s*linear\(([\s\S]*?)\);/)?.[1] ?? ''
    expect(primarySpring).toContain('0.768 20%')
    expect(primarySpring).toContain('1.081 40%')
    const concurrentCloseRule =
      css.match(
        /\.merchant-desktop-new-appointment-overlay:has\([\s\S]*?data-desktop-substep-state='closing'[\s\S]*?\)\s*dialog\.merchant-desktop-new-appointment-dialog\[data-desktop-substep-open='true'\]\s*\{([^}]*)\}/
      )?.[1] ?? ''
    expect(concurrentCloseRule).toContain('transform: translate(-50%, -50%)')
    expect(css).not.toContain('--merchant-desktop-spring')

    const sidecarEntrance = cssSection(
      css,
      '@keyframes merchant-desktop-sidecar-enter',
      '@keyframes merchant-desktop-sidecar-exit'
    )
    const sidecarExit = cssSection(
      css,
      '@keyframes merchant-desktop-sidecar-exit',
      'dialog.merchant-desktop-new-appointment-sidecar\n  [data-desktop-substep-route-motion'
    )

    expect(sidecarEntrance).toContain('left: 100%')
    expect(sidecarEntrance).toContain('left: 50%')
    expect(sidecarEntrance).toContain('transform: translate3d(0, -50%, 0)')
    expect(sidecarEntrance).toContain('transform: translate3d(0.9375rem, -50%, 0)')
    expect(sidecarEntrance).not.toContain('scale(')
    expect(sidecarEntrance).not.toContain('-48%')
    expect(sidecarExit).not.toContain('left:')
    expect(sidecarExit.match(/translate3d\(0\.9375rem, -50%, 0\)/g)).toHaveLength(2)
    expect(sidecarExit).not.toContain('scale(')

    const internalRouteEntrance = cssSection(
      css,
      '@keyframes merchant-desktop-substep-route-enter',
      ':is(\n    dialog.merchant-desktop-new-appointment-dialog'
    )
    expect(internalRouteEntrance).toContain('translate3d(0, 2.5rem, 0)')
    expect(internalRouteEntrance).toContain('translate3d(0, 0, 0)')
  })

  it('keeps desktop home actions visually stable on hover', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).not.toMatch(/(?:a|button|summary)\.merchant-desktop-action:hover/)
  })

  it('uses the four time-specific Poke atmosphere pairs', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    await Promise.all(pokeAtmosphereAssets.map((asset) => access(asset)))

    for (const theme of ['morning', 'afternoon', 'evening', 'night']) {
      expect(css).toContain(`:root[data-merchant-time-theme='${theme}']`)
      expect(css).toContain(`url('/brand/backgrounds/poke/poke-${theme}-sky.jpg')`)
      expect(css).toContain(`url('/brand/backgrounds/poke/poke-beach-${theme}.jpeg')`)
    }
    expect(css).toContain('background: var(--merchant-sky-gradient)')
    expect(css).toContain('background-image: var(--merchant-sky-image)')
    expect(css).toContain('width: max(100%, 125rem)')
    expect(css).toContain('height: max(100%, 75rem)')
    expect(css).toContain('opacity: 0.9')
    expect(css).not.toContain('--merchant-sky-image-filter')
  })

  it('composes the retained home surface from an opaque theme color and grain', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain('--merchant-home-surface: rgb(224 242 254)')
    expect(css).toContain('--merchant-home-surface: rgb(17 23 32)')
    expect(css).toContain(
      "background-image: url('/brand/backgrounds/poke/poke-noise.png')"
    )
    expect(css).toContain('background-image: var(--merchant-home-hero-image)')
    expect(css).toContain('background-blend-mode: overlay')
    expect(css).toContain(
      'mask-image: linear-gradient(to bottom, transparent 0%, black 30px)'
    )
    expect(css).toContain('opacity: var(--merchant-home-sheet-dim-opacity)')
    expect(css).not.toContain(
      'filter: brightness(var(--merchant-home-sheet-brightness))'
    )
    expect(css).toContain('scale(var(--merchant-home-sheet-scale))')
  })

  it('exposes sidebar and status roles to Tailwind', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain('--color-sidebar: var(--sidebar)')
    expect(css).toContain('--color-success: var(--success)')
    expect(css).toContain('--color-warning: var(--warning)')
    expect(css).toContain('--color-info: var(--info)')
  })
})
