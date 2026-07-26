import { describe, expect, it } from 'vitest'
import { merchantViewerFromUser } from './merchant-viewer.ts'

describe('merchantViewerFromUser', () => {
  it('projects only the identity fields required by the merchant shell', () => {
    expect(
      merchantViewerFromUser({
        name: '  Mara Ionescu  ',
        email: '  mara@example.com ',
        emailVerified: true,
        image: '  https://images.example.test/mara.jpg  '
      })
    ).toEqual({
      name: 'Mara Ionescu',
      email: 'mara@example.com',
      emailVerified: true,
      image: 'https://images.example.test/mara.jpg'
    })
  })

  it('does not expose an anonymous session as a viewer', () => {
    expect(merchantViewerFromUser({ name: '  ' })).toBeNull()
  })
})
