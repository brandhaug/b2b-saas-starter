import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const deployment = readFileSync(new URL('../alchemy.run.ts', import.meta.url), 'utf8')

describe('Privacy Action Ledger restore boundary', () => {
  it('provisions a separate D1 authority only for Operations and recovery', () => {
    const resource = deployment.slice(
      deployment.indexOf("Cloudflare.D1Database('beesolo-privacy-ledger-db'"),
      deployment.indexOf('const bookingEventsQueue')
    )
    const operations = deployment.slice(
      deployment.indexOf('const operations ='),
      deployment.indexOf('const booking =')
    )
    const background = deployment.slice(
      deployment.indexOf('const background ='),
      deployment.indexOf('const web =')
    )
    const publicIngress = [
      deployment.slice(
        deployment.indexOf('const api ='),
        deployment.indexOf('const merchant =')
      ),
      deployment.slice(
        deployment.indexOf('const merchant ='),
        deployment.indexOf('const operations =')
      ),
      deployment.slice(
        deployment.indexOf('const booking ='),
        deployment.indexOf('const background =')
      ),
      deployment.slice(
        deployment.indexOf('const web ='),
        deployment.indexOf('return {')
      )
    ].join('\n')

    expect(resource).toContain("name: 'beesolo-privacy-ledger'")
    expect(resource).toContain(
      "migrationsDir: './packages/db/privacy-ledger-migrations'"
    )
    expect(operations).toContain('PRIVACY_LEDGER: privacyLedger')
    expect(background).toContain('PRIVACY_LEDGER: privacyLedger')
    expect(publicIngress).not.toContain('PRIVACY_LEDGER')
  })
})
