import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { PublicLayout } from './public-layout'

const destinations = ['/sign-in', '/workspaces', '/docs', '/help']

describe('public header account call to action', () => {
  it('offers sign-in to a visitor without a session', async () => {
    await renderWithRouter(
      <PublicLayout>
        <main id="main-content">body</main>
      </PublicLayout>,
      { path: '/', destinations, rootLoaderData: { signedIn: false } }
    )
    // The header CTA renders as an anchor carrying `role="button"`.
    const cta = screen.getByRole('button', { name: 'Sign in' })
    expect(cta.getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByRole('button', { name: 'Workspaces' })).toBeNull()
  })

  it('offers the way back into the app on a public page with a session', async () => {
    await renderWithRouter(
      <PublicLayout>
        <main id="main-content">body</main>
      </PublicLayout>,
      { path: '/docs', destinations, rootLoaderData: { signedIn: true } }
    )
    const cta = screen.getByRole('button', { name: 'Workspaces' })
    expect(cta.getAttribute('href')).toBe('/workspaces')
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })
})
