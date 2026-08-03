import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImpersonationBanner } from './impersonation-banner.tsx'
import { remainingImpersonationSeconds } from './impersonation-banner-utils.ts'

describe('ImpersonationBanner', () => {
  it('shows an unmistakable non-dismissible disclosure and stop action', () => {
    const html = renderToStaticMarkup(
      <ImpersonationBanner
        presentation={{
          targetMemberId: 'mem_1',
          targetMemberName: 'Mara Merchant',
          merchantId: 'mer_1',
          merchantName: 'Mara Studio',
          expiresAt: '2026-07-19T16:00:00.000Z'
        }}
        now={() => new Date('2026-07-19T15:15:00.000Z')}
        onStop={async () => undefined}
        onExpired={() => undefined}
      />
    )

    expect(html).toContain('Staff impersonation is active')
    expect(html).toContain('Mara Merchant')
    expect(html).toContain('Mara Studio')
    expect(html).toContain('An operator is acting')
    expect(html).toContain('45:00 remaining')
    expect(html).toContain('Stop impersonation')
    expect(html).not.toContain('Dismiss')
  })

  it('clamps the authoritative countdown at zero', () => {
    expect(
      remainingImpersonationSeconds(
        '2026-07-19T16:00:00.000Z',
        new Date('2026-07-19T15:59:59.100Z')
      )
    ).toBe(1)
    expect(
      remainingImpersonationSeconds(
        '2026-07-19T16:00:00.000Z',
        new Date('2026-07-19T16:00:01.000Z')
      )
    ).toBe(0)
  })
})
