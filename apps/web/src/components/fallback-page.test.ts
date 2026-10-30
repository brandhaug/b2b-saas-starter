import { screen } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { renderNative } from './native-test-harness'

describe('public fallback landmarks', () => {
  it('provides the public shell for a standalone failure', async () => {
    await renderNative({ _tag: 'Error', flags: { status: 500, error: null } })

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  })

  it('keeps one shell when an article fails inside the public layout', async () => {
    await renderNative({
      _tag: 'Public',
      flags: {
        shell: { signedIn: false, locale: 'en', path: '/docs/missing', docs: [] },
        page: { _tag: 'Error', flags: { status: 500, error: null } }
      }
    })

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  })
})
