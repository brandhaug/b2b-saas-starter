import { describe, expect, it } from 'vitest'
import { safeMerchantReturnPath } from './safe-return-path.ts'

describe('safe Merchant App return paths', () => {
  it.each([
    ['/appointments', '/appointments'],
    [
      '/prototype/minimum-merchant-surface?variant=A',
      '/prototype/minimum-merchant-surface?variant=A'
    ],
    ['https://attacker.example', '/'],
    ['//attacker.example', '/'],
    ['sign-in', '/']
  ])('keeps only same-origin paths: %s', (raw, expected) => {
    expect(safeMerchantReturnPath(raw)).toBe(expected)
  })
})
