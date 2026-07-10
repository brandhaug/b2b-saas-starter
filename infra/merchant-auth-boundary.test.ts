import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const deployment = readFileSync(join(root, 'alchemy.run.ts'), 'utf8')

const blockBetween = (start: string, end: string): string => {
  const afterStart = deployment.split(start)[1]
  return afterStart?.split(end)[0] ?? ''
}

describe('Merchant authentication deployment boundary', () => {
  it('binds the Merchant-only secret only to the Merchant App', () => {
    const merchant = blockBetween(
      "Cloudflare.Vite('merchant'",
      "Cloudflare.Vite('booking'"
    )
    const booking = blockBetween(
      "Cloudflare.Vite('booking'",
      "Cloudflare.Worker('background'"
    )
    const web = blockBetween("Cloudflare.Vite('web'", 'return {')

    expect(merchant).toContain('MERCHANT_AUTH_SECRET')
    expect(merchant).not.toContain('BETTER_AUTH_SECRET')
    expect(booking).not.toContain('MERCHANT_AUTH_SECRET')
    expect(web).not.toContain('MERCHANT_AUTH_SECRET')
    expect(web).not.toContain('BETTER_AUTH_SECRET')
  })
})
