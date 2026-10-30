import { screen } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { renderNative } from './native-test-harness'

function renderPublic(signedIn: boolean) {
  return renderNative({
    _tag: 'Public',
    flags: {
      shell: { signedIn, locale: 'en', path: '/', docs: [] },
      page: { _tag: 'Legal', page: 'privacy', controller: null }
    }
  })
}

describe('public header account call to action', () => {
  it('offers sign-in to a visitor without a session', async () => {
    await renderPublic(false)
    const cta = screen.getByRole('link', { name: 'Sign in' })
    expect(cta.getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByRole('link', { name: 'Workspaces' })).toBeNull()
  })

  it('offers the way back into the app on a public page with a session', async () => {
    await renderPublic(true)
    const cta = screen.getByRole('link', { name: 'Workspaces' })
    expect(cta.getAttribute('href')).toBe('/workspaces')
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
})
