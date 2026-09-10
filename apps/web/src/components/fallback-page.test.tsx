import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { PublicLayout } from './public-layout'
import { FallbackPage } from './fallback-page'

describe('public fallback landmarks', () => {
  it('provides the public shell for a standalone failure', async () => {
    await renderWithRouter(
      <FallbackPage>
        <h1>Something went wrong</h1>
      </FallbackPage>
    )

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  })

  it('keeps one shell when an article fails inside the public layout', async () => {
    await renderWithRouter(
      <PublicLayout>
        <main id="main-content">
          <FallbackPage>
            <h1>Something went wrong</h1>
          </FallbackPage>
        </main>
      </PublicLayout>
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  })
})
