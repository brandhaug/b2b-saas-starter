import { screen } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { renderAuth } from '@/components/native-test-harness'

// The page only reports what the auth handler's redirect already decided, so
// no port to inject and no props to vary: `beforeLoad` guarantees an error
// param by the time it renders, and every failure code gets the same opaque
// state. Success never renders it — the route's beforeLoad continues straight
// to /workspaces.
describe('MagicLinkVerifyPage', () => {
  it('reports the opaque failure state for an expired or used link', async () => {
    await renderAuth('magic-link', { search: '?error=INVALID_TOKEN' })
    screen.getByText('This sign-in link cannot be used')
    expect(
      screen.getByRole('link', { name: 'Request a new link or use your password' })
    ).toBeDefined()
    expect(screen.getByText(/expires ten minutes/)).toBeDefined()
  })
})
