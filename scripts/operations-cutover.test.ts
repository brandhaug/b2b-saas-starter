import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8')

describe('Operations model cutover', () => {
  it('removes global auth while preserving the dedicated auth factories', () => {
    const auth = read('packages/auth/src/index.ts')
    const webPackage = JSON.parse(read('apps/web/package.json')) as {
      dependencies: Record<string, string>
    }

    expect(auth).not.toMatch(/export function createAuth\b/)
    expect(auth).not.toContain('better-auth/plugins/admin')
    expect(auth).not.toContain('better-auth/plugins/username')
    expect(auth).toMatch(/export function createMerchantAuth\b/)
    expect(auth).toMatch(/export function createCustomerAuth\b/)
    expect(read('packages/auth/src/operations.ts')).toMatch(
      /export const createOperationsAuth\b/
    )
    expect(
      existsSync(resolve(repositoryRoot, 'apps/web/src/lib/server-context.ts'))
    ).toBe(false)
    expect(webPackage.dependencies).not.toHaveProperty('@b2b-saas-starter/auth')
    expect(webPackage.dependencies).not.toHaveProperty('better-auth')
  })

  it('removes the Public Site auth environment and superseded admin documentation', () => {
    const serverEnv = read('packages/env/src/server.ts')
    const domainLanguage = read('CONTEXT.md')
    const publicContent = [
      read('apps/web/src/lib/content.ts'),
      read('apps/web/public/llms-full.txt'),
      ...[
        'apps/web/content/docs/architecture/workers.mdx',
        'apps/web/content/docs/getting-started/module-wiring.mdx',
        'apps/web/content/docs/getting-started/cloudflare-deployment.mdx',
        'apps/web/content/docs/starter-modules/auth.mdx'
      ].map(read)
    ].join('\n')

    expect(serverEnv).not.toMatch(/\bBETTER_AUTH_(?:SECRET|URL|TRUSTED_ORIGINS)\b/)
    expect(serverEnv).not.toMatch(/\bGITHUB_CLIENT_(?:ID|SECRET)\b/)
    expect(
      existsSync(
        resolve(repositoryRoot, 'apps/web/content/docs/governance/system-admin.mdx')
      )
    ).toBe(false)
    expect(publicContent).not.toMatch(
      /Better Auth admin plugin|System Admin|\/admin route/
    )
    expect(publicContent).not.toMatch(/GitHub OAuth|BETTER_AUTH_URL/)
    expect(domainLanguage).toContain('**System Operator**:')
    expect(domainLanguage).not.toContain('**System Admin**:')
  })

  it('documents the sixth Worker and every supported operator procedure', () => {
    const readme = read('README.md')
    const architecture = read('ARCHITECTURE.md')
    const setup = read('docs/setup.md')
    const runbook = read('docs/operations.md')
    const webIntent = read('apps/web/AGENTS.md')
    const exampleEnv = read('.env.example')

    expect(readme).toContain('| Operations App')
    expect(readme).toContain('bun run dev:operations')
    expect(readme).toContain('apps/operations')
    expect(architecture).toContain('## Six Workers')
    expect(architecture).toContain('Operator browser ──> Operations App')
    expect(setup).toContain('http://localhost:3076')
    expect(setup).toContain('OPERATIONS_AUTH_SECRET')
    expect(webIntent).toContain('staff authentication belongs to')
    expect(webIntent).toContain('apps/operations')
    expect(exampleEnv).toContain('ENVIRONMENT=development')
    expect(exampleEnv).toContain('OPERATIONS_SECURITY_CONTACT=')

    for (const heading of [
      'Production cutover order',
      'Local deterministic operator',
      'Invite and enroll an operator',
      'Emergency recovery',
      'Impersonation procedure',
      'Target notifications',
      'Global audit review'
    ]) {
      expect(runbook).toContain(`## ${heading}`)
    }
    expect(runbook).toContain('Cloudflare Access is deferred')
  })
})
