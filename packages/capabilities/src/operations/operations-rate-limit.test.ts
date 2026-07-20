import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  OperationsRateLimit,
  makeOperationsRateLimitLayer,
  type OperationsRateLimitAdapter
} from './operations-contracts.ts'

type Request = {
  readonly category:
    | 'operator-session-read'
    | 'operator-authentication'
    | 'operator-totp'
    | 'merchant-discovery'
    | 'operator-management'
    | 'impersonation-start'
    | 'handoff-exchange'
  readonly subjectKey: string
  readonly sourceKey: string
  readonly operation: string
}

const retryAfterSeconds = {
  'operator-session-read': 60,
  'operator-authentication': 90,
  'operator-totp': 120,
  'merchant-discovery': 60,
  'operator-management': 60,
  'impersonation-start': 60,
  'handoff-exchange': 60
} as const

const consume = (
  request: Request,
  adapter: OperationsRateLimitAdapter,
  now?: () => Date
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rateLimit = yield* OperationsRateLimit
      return yield* rateLimit.consume(request)
    }).pipe(
      Effect.provide(
        makeOperationsRateLimitLayer({
          adapter,
          retryAfterSeconds,
          ...(now ? { now } : {})
        })
      )
    )
  )

describe('Operations rate-limit contract', () => {
  it('isolates session reads, password authentication, and TOTP with opaque composite keys', async () => {
    const taken: Array<{ category: string; key: string }> = []
    const adapter: OperationsRateLimitAdapter = {
      consume: (input) => {
        taken.push(input)
        return Promise.resolve(true)
      },
      recordDenied: () => Promise.resolve()
    }
    const common = {
      subjectKey: 'operator@example.test',
      sourceKey: '203.0.113.7',
      operation: 'verify'
    } as const

    await consume({ ...common, category: 'operator-session-read' }, adapter)
    await consume({ ...common, category: 'operator-authentication' }, adapter)
    await consume({ ...common, category: 'operator-totp' }, adapter)

    expect(taken.map(({ category }) => category)).toEqual([
      'operator-session-read',
      'operator-authentication',
      'operator-totp'
    ])
    expect(new Set(taken.map(({ key }) => key))).toHaveLength(3)
    expect(JSON.stringify(taken)).not.toContain('operator@example.test')
    expect(JSON.stringify(taken)).not.toContain('203.0.113.7')
  })

  it('changes the opaque key for each subject, source, and operation dimension', async () => {
    const keys: string[] = []
    const adapter: OperationsRateLimitAdapter = {
      consume: ({ key }) => {
        keys.push(key)
        return Promise.resolve(true)
      },
      recordDenied: () => Promise.resolve()
    }
    const common = {
      category: 'operator-authentication',
      subjectKey: 'operator@example.test',
      sourceKey: '203.0.113.7',
      operation: 'password'
    } as const

    await consume(common, adapter)
    await consume({ ...common, subjectKey: 'other@example.test' }, adapter)
    await consume({ ...common, sourceKey: '198.51.100.9' }, adapter)
    await consume({ ...common, operation: 'backup-code' }, adapter)

    expect(new Set(keys)).toHaveLength(4)
  })

  it('returns retry guidance and emits one stable evidence identity per denial window', async () => {
    let now = new Date('2026-07-19T10:00:00.000Z')
    const denied: Parameters<OperationsRateLimitAdapter['recordDenied']>[0][] = []
    const adapter: OperationsRateLimitAdapter = {
      consume: () => Promise.resolve(false),
      recordDenied: (input) => {
        denied.push(input)
        return Promise.resolve()
      }
    }
    const request = {
      category: 'operator-authentication',
      subjectKey: 'operator@example.test',
      sourceKey: '203.0.113.7',
      operation: 'password'
    } as const

    expect(await consume(request, adapter, () => now)).toEqual({
      allowed: false,
      retryAfterSeconds: 90
    })
    await consume(request, adapter, () => now)
    expect(denied).toHaveLength(2)
    expect(new Set(denied.map(({ id }) => id))).toHaveLength(1)
    expect(JSON.stringify(denied)).not.toContain('operator@example.test')
    expect(JSON.stringify(denied)).not.toContain('203.0.113.7')

    now = new Date('2026-07-19T10:01:31.000Z')
    await consume(request, adapter, () => now)
    expect(new Set(denied.map(({ id }) => id))).toHaveLength(2)
  })

  it('maps limiter and audit adapter failures to a typed unavailable error', async () => {
    const request = {
      category: 'operator-authentication',
      subjectKey: 'operator@example.test',
      sourceKey: '203.0.113.7',
      operation: 'password'
    } as const
    await expect(
      consume(request, {
        consume: () => Promise.reject(new Error('binding failed')),
        recordDenied: () => Promise.resolve()
      })
    ).rejects.toMatchObject({
      _tag: 'OperationsRateLimitUnavailable',
      reason: 'operations rate limit is unavailable'
    })
    await expect(
      consume(request, {
        consume: () => Promise.resolve(false),
        recordDenied: () => Promise.reject(new Error('D1 failed'))
      })
    ).rejects.toMatchObject({ _tag: 'OperationsRateLimitUnavailable' })
  })
})
