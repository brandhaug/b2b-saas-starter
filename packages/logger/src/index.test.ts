import { Data, Effect, Exit, Logger, Metric, type Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { readWideEventEnvironment } from './environment.ts'
import {
  currentTraceId,
  currentTraceparent,
  parentSpanFromHeaders,
  traceparentFor
} from './trace.ts'
import {
  withHttpRequestScope,
  withRequestScope,
  withTriggerScope
} from './wide-event.ts'

/** One captured log record, in the shape `Logger.consoleJson` would print. */
type Captured = {
  readonly level: string
  readonly message: unknown
  readonly annotations: Record<string, unknown>
  readonly cause: string | undefined
}

/**
 * Captures what the JSON logger would have emitted. Built on
 * `formatStructured` so the assertions below read the real shape — message,
 * level, annotation bag, cause — instead of a hand-rebuilt one.
 */
/** A logger layer plus the array it appends every structured record to. */
type Collector = {
  readonly layer: Layer.Layer<never>
  readonly records: Captured[]
}

function collector(): Collector {
  const records: Captured[] = []
  const logger = Logger.map(Logger.formatStructured, (structured) => {
    records.push({
      level: structured.level,
      message: structured.message,
      annotations: structured.annotations,
      cause: structured.cause
    })
  })
  return { layer: Logger.layer([logger]), records }
}

/** The single canonical line a scope must have emitted. */
function only(records: readonly Captured[]): Captured {
  expect(records).toHaveLength(1)
  const [record] = records
  if (!record) return { level: '', message: '', annotations: {}, cause: undefined }
  return record
}

class Boom extends Data.TaggedError('Boom')<{ readonly why: string }> {}

describe('withRequestScope', () => {
  it.effect('emits exactly one canonical line carrying handler annotations', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      yield* withRequestScope(
        {
          service: 'api',
          event: 'request.health',
          environment: { environment: 'test', commitHash: 'abc123' },
          metadata: { pathname: '/health', method: 'GET' }
        },
        Effect.annotateLogsScoped({ workspaceId: 'ws_1', plan: 'pro' })
      )

      const record = only(records)
      expect(record.message).toBe('request.health')
      expect(record.level).toBe('INFO')
      expect(record.annotations).toMatchObject({
        service: 'api',
        status: 'ok',
        pathname: '/health',
        method: 'GET',
        environment: 'test',
        commitHash: 'abc123',
        // Business context added mid-request still lands on the one event —
        // the regression `Effect.onExit` (not `addFinalizer`) prevents.
        workspaceId: 'ws_1',
        plan: 'pro'
      })
      expect(record.annotations['durationMs']).toEqual(expect.any(Number))
    }).pipe(Effect.provide(layer))
  })

  it.effect('correlates x-trace-id with the OTel trace id', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      yield* withRequestScope({ service: 'api', event: 'request.health' }, Effect.void)
      const { annotations } = only(records)
      expect(annotations['traceId']).toBe(annotations['otelTraceId'])
      expect(annotations['otelSpanId']).toEqual(expect.any(String))
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps an explicit correlation id while still reporting OTel ids', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      yield* withRequestScope(
        { service: 'api', event: 'request.health', traceId: 'upstream-id' },
        Effect.void
      )
      const { annotations } = only(records)
      expect(annotations['traceId']).toBe('upstream-id')
      expect(annotations['otelTraceId']).not.toBe('upstream-id')
    }).pipe(Effect.provide(layer))
  })

  it.effect('logs a typed failure at error level with its tag and cause', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(
        withRequestScope(
          { service: 'api', event: 'request.tokens' },
          Effect.fail(new Boom({ why: 'nope' }))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      const record = only(records)
      expect(record.level).toBe('ERROR')
      expect(record.cause).toContain('Boom')
      expect(record.annotations).toMatchObject({
        status: 'error',
        errorKind: 'fail',
        errorTag: 'Boom'
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect('classifies a defect apart from a typed failure', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      yield* Effect.exit(
        withRequestScope(
          { service: 'api', event: 'request.tokens' },
          Effect.die('kaboom')
        )
      )
      expect(only(records).annotations).toMatchObject({
        status: 'error',
        errorKind: 'defect'
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect('records RED metrics carrying the status the event reports', () => {
    const { layer } = collector()
    return Effect.gen(function* () {
      yield* withRequestScope(
        { service: 'metrics-test', event: 'request.metered' },
        Effect.void
      )
      yield* Effect.exit(
        withRequestScope(
          { service: 'metrics-test', event: 'request.metered' },
          Effect.fail(new Boom({ why: 'nope' }))
        )
      )

      const snapshot = yield* Metric.snapshot
      const series = snapshot.filter(
        (metric) => metric.attributes?.['event'] === 'request.metered'
      )
      // A counter and a duration histogram per outcome: ok and error never
      // collapse into one series.
      expect(series.map((metric) => metric.id).toSorted()).toEqual([
        'starter.request.duration',
        'starter.request.duration',
        'starter.requests',
        'starter.requests'
      ])
      expect(
        series.map((metric) => String(metric.attributes?.['status'])).toSorted()
      ).toEqual(['error', 'error', 'ok', 'ok'])
    }).pipe(Effect.provide(layer))
  })
})

describe('trace propagation', () => {
  const UPSTREAM = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

  it('round-trips a span through the W3C traceparent header', () => {
    const span = parentSpanFromHeaders({ traceparent: UPSTREAM })
    expect(span?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(span?.spanId).toBe('b7ad6b7169203331')
    expect(span?.sampled).toBe(true)
    expect(span && traceparentFor(span)).toBe(UPSTREAM)
  })

  it('ignores a malformed or absent traceparent instead of failing', () => {
    expect(parentSpanFromHeaders({ traceparent: 'not-a-header' })).toBeUndefined()
    expect(parentSpanFromHeaders({ traceparent: undefined })).toBeUndefined()
  })

  it.effect('continues an upstream trace and hands it to producers', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      const stamped = yield* withTriggerScope(
        {
          service: 'api',
          event: 'publish',
          parent: parentSpanFromHeaders({ traceparent: UPSTREAM }),
          spanKind: 'producer'
        },
        currentTraceparent
      )

      // What the queue message carries: the same trace, a new span id.
      expect(stamped).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[\da-f]{16}-01$/)
      expect(only(records).annotations['otelTraceId']).toBe(
        '0af7651916cd43dd8448eb211c80319c'
      )
    }).pipe(Effect.provide(layer))
  })

  it.effect('derives the outbound x-trace-id from the enclosing span', () => {
    const { layer, records } = collector()
    return Effect.gen(function* () {
      const traceId = yield* withTriggerScope(
        { service: 'background', event: 'webhook_delivery' },
        currentTraceId
      )
      expect(traceId).toBe(only(records).annotations['otelTraceId'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('falls back to a fresh correlation id outside any span', () =>
    Effect.gen(function* () {
      const traceId = yield* currentTraceId
      expect(traceId.length).toBeGreaterThan(0)
    })
  )
})

describe('withHttpRequestScope', () => {
  it.effect(
    'reads method, pathname, correlation id, and parent from the request',
    () => {
      const { layer, records } = collector()
      const request = new Request('https://api.example.com/v1/workspaces/acme', {
        method: 'POST',
        headers: {
          'x-trace-id': 'corr-1',
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
        }
      })
      return Effect.gen(function* () {
        yield* withHttpRequestScope(
          { service: 'web', event: 'web.request', request, env: { ENVIRONMENT: 'ci' } },
          Effect.void
        )
        expect(only(records).annotations).toMatchObject({
          service: 'web',
          method: 'POST',
          pathname: '/v1/workspaces/acme',
          traceId: 'corr-1',
          otelTraceId: '0af7651916cd43dd8448eb211c80319c',
          environment: 'ci'
        })
      }).pipe(Effect.provide(layer))
    }
  )
})

describe('readWideEventEnvironment', () => {
  it('reads the deployment identity a wide event needs', () => {
    expect(
      readWideEventEnvironment({
        GIT_COMMIT_SHA: 'deadbeef',
        SERVICE_VERSION: '1.4.0',
        ENVIRONMENT: 'production'
      })
    ).toEqual({
      commitHash: 'deadbeef',
      serviceVersion: '1.4.0',
      environment: 'production'
    })
  })

  it('prefers the Cloudflare colo over a configured region', () => {
    expect(
      readWideEventEnvironment({ CF_REGION: 'weur' }, { colo: 'ARN' }).region
    ).toBe('ARN')
  })

  it('omits absent keys rather than emitting empty columns', () => {
    expect(readWideEventEnvironment(undefined)).toEqual({})
    expect(Object.keys(readWideEventEnvironment({ ENVIRONMENT: '' }))).toEqual([])
  })
})
