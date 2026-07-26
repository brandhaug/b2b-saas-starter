import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BeeSoloLogo, BeeSoloMark } from './beesolo-logo.tsx'

describe('BeeSoloLogo', () => {
  it('renders the canonical mark and lowercase wordmark', () => {
    const html = renderToStaticMarkup(<BeeSoloLogo />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('viewBox="0 0 126 126"')
    expect(html).toContain('>b</span>')
    expect(html).toContain('>.</span>')
  })

  it('can render the mark without the wordmark', () => {
    const html = renderToStaticMarkup(<BeeSoloLogo iconOnly />)

    expect(html).toContain('aria-label="BeeSolo"')
    expect(html).not.toContain('beesolo-logo-letter')
  })

  it('renders a reusable monochrome mark without a tile background', () => {
    const html = renderToStaticMarkup(<BeeSoloMark className="size-6" />)

    expect(html).toContain('class="size-6"')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toContain('fill="white"')
    expect(html).not.toContain('bg-white')
    expect(html).not.toContain('rounded-sm')
  })
})
