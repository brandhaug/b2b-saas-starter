import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ParityLedger } from '../../apps/booking/src/parity/full-parity-ledger.ts'
import { productionIngress, renderIngressInventory } from './ingress.ts'
import {
  collectCandidateSourceIssues,
  validateReleaseParity,
  validateSoloCandidate
} from './candidate-policy.ts'
import {
  createCandidateManifest,
  candidateConfigurationFiles
} from './candidate-manifest.ts'
import { releaseBaselineVerificationSuites } from './fixture-evidence.ts'

const ledger = (status: 'planned' | 'implemented' | 'verified'): ParityLedger => ({
  version: 1,
  inventory: [
    { id: 'route:booking', kind: 'route', description: 'Booking', source: 'test' }
  ],
  entries: [
    {
      inventoryId: 'route:booking',
      owner: 'booking',
      scenario: 'journey/booking',
      status
    }
  ]
})

describe('beesolo release baseline', () => {
  it('renders every owned production ingress with a verification seam', () => {
    const report = renderIngressInventory()
    for (const ingress of productionIngress) {
      expect(ingress.owner).not.toBe('')
      expect(ingress.verification).not.toBe('')
      expect(report.replaceAll('\\|', '|')).toContain(ingress.pattern)
    }
    expect(productionIngress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: 'POST /callbacks/stripe/subscriptions'
        }),
        expect.objectContaining({
          pattern: 'POST /callbacks/email/transactional'
        }),
        expect.objectContaining({
          pattern: 'GET|POST /callbacks/meta/whatsapp'
        }),
        expect.objectContaining({ pattern: 'POST /callbacks/smso/:pathSecret' }),
        expect.objectContaining({
          kind: 'deferred-route',
          pattern: 'POST /:merchantSlug/booking/payment-callback/:provider'
        })
      ])
    )
    expect(report).toContain('GET\\|POST /callbacks/meta/whatsapp')
    expect(
      report.split('\n').find((line) => line.includes('meta/whatsapp'))
    ).not.toMatch(/\| GET\s+\| POST /)
  })

  it('rejects planned parity, Platform API ingress, and deferred ingress', () => {
    const issues = validateSoloCandidate(ledger('planned'))
    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['planned', 'platform-api', 'deferred-ingress'])
    )
  })

  it('rejects accepted parity inventory with no owning ledger entry', () => {
    const issues = validateReleaseParity({ ...ledger('verified'), entries: [] })

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unowned' }))
  })

  it('rejects active starter, Team, Platform API, and Provider-choice sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beesolo-release-baseline-'))
    await Promise.all(
      [
        'apps/web/content/docs',
        'apps/web/src/routes',
        'apps/merchant/src/components',
        'apps/booking/src/components',
        'apps/api/src',
        'packages/capabilities/src/team',
        'packages/db/src',
        'docs/adr'
      ].map((path) => mkdir(join(root, path), { recursive: true }))
    )
    await Promise.all([
      writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: 'b2b-saas-starter', description: 'Starter template' })
      ),
      writeFile(join(root, 'README.md'), '# Platform API\n'),
      writeFile(
        join(root, 'apps/web/content/docs/product.mdx'),
        '# B2B SaaS Starter product documentation\n'
      ),
      writeFile(join(root, 'docs/setup.md'), '# Invite staff with per-seat billing\n'),
      writeFile(
        join(root, 'docs/adr/0001-history.md'),
        '# Historical Platform API and Team Plan decision\n'
      ),
      writeFile(
        join(root, 'apps/web/src/routes/pricing.tsx'),
        `const plan = { name: 'Team' }`
      ),
      writeFile(
        join(root, 'apps/merchant/src/components/navigation.tsx'),
        `<><title>B2B SaaS Starter</title><NavItem label="Providers" to="/providers" /></>`
      ),
      writeFile(
        join(root, 'apps/booking/src/components/selection.tsx'),
        `const showProviders = true; messages.providerCards.anyProvider`
      ),
      writeFile(
        join(root, 'apps/api/src/team-contract.ts'),
        `export const listMembers = () => []`
      ),
      writeFile(
        join(root, 'packages/capabilities/src/team/members.ts'),
        `export const role = 'employee'`
      ),
      writeFile(
        join(root, 'packages/capabilities/src/team/team.AGENTS.md'),
        '# Historical constraint: additional Provider behavior is prohibited\n'
      ),
      writeFile(
        join(root, 'packages/db/src/provider-policy.ts'),
        `export const selectProvider = () => undefined`
      )
    ])

    expect((await collectCandidateSourceIssues(root)).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'active-starter-identity',
        'team-behavior',
        'platform-api',
        'provider-choice',
        'provider-navigation'
      ])
    )
    expect(
      (await collectCandidateSourceIssues(root)).some(
        ({ message }) =>
          message.includes('docs/adr/0001-history.md') || message.includes('AGENTS.md')
      )
    ).toBe(false)
    expect(
      (await collectCandidateSourceIssues(root)).map(({ message }) => message)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('apps/api/src/team-contract.ts'),
        expect.stringContaining('packages/capabilities/src/team/members.ts'),
        expect.stringContaining('packages/db/src/provider-policy.ts')
      ])
    )
  })

  it('binds API configuration and migration contents into candidate identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beesolo-candidate-manifest-'))
    await mkdir(join(root, 'packages/db/migrations/20260803000000_baseline'), {
      recursive: true
    })
    await writeFile(
      join(root, 'packages/db/migrations/20260803000000_baseline/migration.sql'),
      'CREATE TABLE release_baseline (id TEXT PRIMARY KEY);'
    )
    await writeFile(join(root, 'artifact.js'), 'artifact')
    await writeFile(join(root, 'config.json'), '{"binding":"DB"}')

    const manifest = await createCandidateManifest({
      root,
      commit: 'abc123',
      artifacts: ['artifact.js'],
      parityRevision: 'parity-digest',
      configurationFiles: ['config.json']
    })

    expect(candidateConfigurationFiles).toContain('apps/api/wrangler.jsonc')
    expect(manifest.schemaBaseline).toEqual({
      name: '20260803000000_baseline',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('executes the typed Transactional Email callback and canonical fixture seams', () => {
    expect(releaseBaselineVerificationSuites).toEqual(
      expect.arrayContaining([
        'apps/api/src/index.test.ts',
        'apps/api/src/transactional-email-callback.test.ts',
        'packages/capabilities/src/booking/booking-confirmation.test.ts',
        'scripts/release-baseline/fixture-contract.test.ts'
      ])
    )
  })
})
