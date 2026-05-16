import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('home route copy', () => {
  it('keeps the public positioning starter-focused', () => {
    render(<h1>Inspect a B2B SaaS starter that ships with the hard parts wired.</h1>)
    expect(screen.getByText(/B2B SaaS starter/)).toBeTruthy()
  })
})
