import { expect, it, vi } from 'vite-plus/test'

import { randomHex } from './crypto'

// Failure cases: lost leading zeros, reduced entropy length, insecure fallback.
it('encodes every requested secure byte as two lowercase hex digits', ({
  onTestFinished
}) => {
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    expect(bytes).toHaveLength(4)
    bytes.set([0, 1, 128, 255])
    return array
  })
  expect(randomHex(4)).toBe('000180ff')
})

it('supports zero bytes and rejects negative lengths', () => {
  expect(randomHex(0)).toBe('')
  expect(() => randomHex(-1)).toThrow('size must be a non-negative safe integer')
})

it('does not fall back when the platform CSPRNG fails', ({ onTestFinished }) => {
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
    throw new Error('entropy unavailable')
  })
  expect(() => randomHex(32)).toThrow('entropy unavailable')
})
