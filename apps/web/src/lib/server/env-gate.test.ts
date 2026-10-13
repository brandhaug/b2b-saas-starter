import { type RequiredEnvProblem } from '@b2b-saas-starter/env/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { enforceRequiredEnvAudit, InsecureProductionEnvError } from './env-gate.ts'

const { env } = vi.hoisted(() => ({
  env: {
    ENVIRONMENT: 'production',
    BETTER_AUTH_SECRET: 'local-dev-secret',
    BETTER_AUTH_URL: 'https://app.brandhaug.net',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example'
  }
}))

vi.mock('cloudflare:workers', () => ({ env }))

describe('enforceRequiredEnvAudit', () => {
  it('passes a clean production audit', () => {
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'production',
        problems: []
      })
    ).not.toThrow()
  })

  it('is silent for local and non-production deployments', () => {
    // Even with problems: a non-production deployment warns via a wide
    // event, it does not refuse to serve.
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'local',
        problems: []
      })
    ).not.toThrow()
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'deployed',
        problems: [{ key: 'BETTER_AUTH_SECRET', reason: 'missing' }]
      })
    ).not.toThrow()
  })

  it('refuses to serve when production required env is insecure', () => {
    const problems: ReadonlyArray<RequiredEnvProblem> = [
      { key: 'BETTER_AUTH_SECRET', reason: 'placeholder' },
      { key: 'BETTER_AUTH_URL', reason: 'missing' }
    ]

    // Start serializes request-middleware error messages to RPC callers.
    // Configuration diagnostics belong only in the server's wide event.
    expect(() => enforceRequiredEnvAudit({ mode: 'production', problems })).toThrow(
      InsecureProductionEnvError
    )
    expect(() => enforceRequiredEnvAudit({ mode: 'production', problems })).toThrow(
      'Service unavailable'
    )
  })
})

describe('production configuration gate', () => {
  const lines: Array<string> = []
  const payloads: Array<string> = []
  let onExport: (() => Promise<void>) | undefined

  beforeEach(() => {
    vi.resetModules()
    lines.length = 0
    payloads.length = 0
    onExport = undefined
    env.BETTER_AUTH_SECRET = 'local-dev-secret'
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line))
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
      payloads.push(await new Response(init.body).text())
      await onExport?.()
      return new Response('{}')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps refusing requests while logging configuration diagnostics once', async () => {
    const { enforceRequiredEnvOnce } = await import('./env-gate.ts')
    await expect(enforceRequiredEnvOnce()).rejects.toThrow('Service unavailable')
    await expect(enforceRequiredEnvOnce()).rejects.toThrow('Service unavailable')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('"config.BETTER_AUTH_SECRET":"placeholder"')
    expect(payloads.join('\n')).toContain('config.BETTER_AUTH_SECRET')
    expect(payloads.join('\n')).toContain('placeholder')
    expect([...lines, ...payloads].join('\n')).not.toContain('local-dev-secret')
  })

  it('rechecks a failed configuration so a corrected binding can recover', async () => {
    const { enforceRequiredEnvOnce } = await import('./env-gate.ts')
    await expect(enforceRequiredEnvOnce()).rejects.toThrow('Service unavailable')
    env.BETTER_AUTH_SECRET = 'production-test-secret-with-sufficient-length'
    await expect(enforceRequiredEnvOnce()).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
  })

  it('waits for diagnostic export before rejecting the invocation', async () => {
    let startExport: (() => void) | undefined
    let finishExport: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      startExport = resolve
    })
    const flush = new Promise<void>((resolve) => {
      finishExport = resolve
    })
    onExport = () => {
      startExport?.()
      return flush
    }
    const { enforceRequiredEnvOnce } = await import('./env-gate.ts')
    let settled = false
    const request = enforceRequiredEnvOnce().then(
      () => {
        settled = true
        return null
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    await started
    expect(settled).toBe(false)
    finishExport?.()
    expect(await request).toHaveProperty('message', 'Service unavailable')
  })
})
