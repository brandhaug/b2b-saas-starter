import { Effect, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  memoizePerRequest,
  runWebRequestScope,
  withWebRequestScope
} from './observability'

/**
 * The ambient request is the one input these functions read from outside their
 * arguments, so it is the one thing the tests set. Both entry points take the
 * lookup as their last argument (`CurrentRequest`), so this is a real function
 * of the shape they expect and everything else — the real runtime, the real
 * loggers, the real spans — stays in play.
 */
type AmbientRequest = { request: Request | undefined }

const ambient: AmbientRequest = { request: undefined }

function lookupRequest(): Request | undefined {
  return ambient.request
}

// The captured line is decoded rather than cast: the assertions below are about
// the shape `Logger.consoleJson` actually prints, so a shape change should fail
// the decode instead of silently reading `undefined`.
const CapturedLine = Schema.Struct({
  message: Schema.Unknown,
  level: Schema.String,
  annotations: Schema.Record(Schema.String, Schema.Unknown)
})
type Captured = typeof CapturedLine.Type

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(CapturedLine))
const decodeNested = Schema.decodeUnknownSync(
  Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
)

/**
 * Captures what actually reached the console. `WideEventLoggerLive` writes
 * through `Logger.consoleJson`, so spying here exercises the real logger set
 * and the real runtime instead of a stand-in.
 */
let lines: Array<Captured> = []

beforeEach(() => {
  lines = []
  ambient.request = undefined
  vi.spyOn(console, 'log').mockImplementation((...args: ReadonlyArray<unknown>) => {
    lines.push(decodeLine(args[0]))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The single line a request must have emitted. */
function only(): Captured {
  expect(lines).toHaveLength(1)
  const [record] = lines
  if (!record) {
    throw new Error('no canonical line was emitted')
  }
  return record
}

/** The `nested` array the request folded its child runs into. */
function nestedEntries(record: Captured): ReadonlyArray<Record<string, unknown>> {
  return decodeNested(record.annotations['nested'])
}

describe('runWebRequestScope', () => {
  it('emits exactly one canonical line, with every nested run folded into it', async () => {
    const request = new Request('http://localhost/workspaces/acme')
    ambient.request = request

    const response = await runWebRequestScope(
      { request, handlerType: 'router' },
      async () => {
        // Two nested runs, exactly as a loader and a server function do it: a
        // bare `Effect.runPromise*` over `withWebRequestScope`.
        await Effect.runPromise(
          withWebRequestScope(
            { event: 'capability.workspace', metadata: { workspaceSlug: 'acme' } },
            Effect.annotateLogsScoped({ unreadCount: 42 }),
            lookupRequest
          )
        )
        await Effect.runPromiseExit(
          withWebRequestScope(
            { event: 'capability.global' },
            Effect.fail('nope'),
            lookupRequest
          )
        )
        return new Response('ok', { status: 201 })
      },
      lookupRequest
    )

    expect(response.status).toBe(201)
    const record = only()
    expect(record.message).toBe('web.request')
    expect(record.level).toBe('INFO')
    expect(record.annotations).toMatchObject({
      service: 'web',
      pathname: '/workspaces/acme',
      handlerType: 'router',
      statusCode: 201
    })
    // Each nested run reports its own annotations and its own status; a failing
    // nested run does not change the request's own outcome.
    expect(nestedEntries(record)).toEqual([
      {
        event: 'capability.workspace',
        workspaceSlug: 'acme',
        unreadCount: 42,
        status: 'ok'
      },
      { event: 'capability.global', status: 'error' }
    ])
  })

  it('joins the request event even when the ambient request is another instance', async () => {
    // Start re-wraps the request as it flows through the handler chain, so the
    // middleware and the loaders can hold different `Request` objects. The
    // second `registry.set` in `registerAndRun` is what covers that.
    const registered = new Request('http://localhost/workspaces/acme')
    ambient.request = new Request('http://localhost/workspaces/acme')

    await runWebRequestScope(
      { request: registered, handlerType: 'router' },
      async () => {
        await Effect.runPromise(
          withWebRequestScope(
            { event: 'capability.global' },
            Effect.void,
            lookupRequest
          )
        )
        return new Response(null, { status: 204 })
      },
      lookupRequest
    )

    const record = only()
    expect(record.message).toBe('web.request')
    expect(nestedEntries(record)).toEqual([
      { event: 'capability.global', status: 'ok' }
    ])
    // No standalone marker: the nested run joined instead of opening a second
    // event of its own.
    expect(record.annotations['scope']).toBeUndefined()
  })
})

describe('memoizePerRequest', () => {
  it('dedupes calls per key within one request scope, not across keys', async () => {
    const request = new Request('http://localhost/workspaces/acme')
    ambient.request = request
    let reads = 0
    async function make() {
      reads += 1
      return `value-${reads}`
    }

    await runWebRequestScope(
      { request, handlerType: 'router' },
      async () => {
        // Two callers in the same request — the beforeLoad gate and a server
        // function — must share one read.
        expect(await memoizePerRequest('auth.session', make, lookupRequest)).toBe(
          'value-1'
        )
        expect(await memoizePerRequest('auth.session', make, lookupRequest)).toBe(
          'value-1'
        )
        // A different key is its own slot.
        expect(await memoizePerRequest('other.key', make, lookupRequest)).toBe(
          'value-2'
        )
        return new Response(null, { status: 204 })
      },
      lookupRequest
    )

    expect(reads).toBe(2)
  })

  it('shares one slot when Start re-wraps the request mid-flight', async () => {
    const registered = new Request('http://localhost/workspaces/acme')
    ambient.request = new Request('http://localhost/workspaces/acme')
    let reads = 0

    await runWebRequestScope(
      { request: registered, handlerType: 'router' },
      async () => {
        await memoizePerRequest(
          'auth.session',
          async () => {
            reads += 1
          },
          lookupRequest
        )
        await memoizePerRequest(
          'auth.session',
          async () => {
            reads += 1
          },
          lookupRequest
        )
        return new Response(null, { status: 204 })
      },
      lookupRequest
    )

    expect(reads).toBe(1)
  })

  it('falls back to calling make on every call outside a request scope', async () => {
    let reads = 0
    async function make() {
      reads += 1
      return reads
    }

    expect(await memoizePerRequest('k', make, lookupRequest)).toBe(1)
    expect(await memoizePerRequest('k', make, lookupRequest)).toBe(2)
  })

  it('does not leak memoized values into a later request', async () => {
    const first = new Request('http://localhost/first')
    const second = new Request('http://localhost/second')
    let reads = 0
    async function make() {
      reads += 1
      return `read-${reads}`
    }
    async function run(request: Request): Promise<Response> {
      return runWebRequestScope(
        { request, handlerType: 'router' },
        async () => {
          await memoizePerRequest('k', make, lookupRequest)
          return new Response(null, { status: 204 })
        },
        lookupRequest
      )
    }

    ambient.request = first
    await run(first)
    ambient.request = second
    await run(second)

    expect(reads).toBe(2)
  })
})

describe('withWebRequestScope', () => {
  it('flags its own event as standalone when there is no request to join', async () => {
    ambient.request = undefined

    await Effect.runPromise(
      withWebRequestScope(
        { event: 'capability.global', metadata: { workspaceSlug: 'acme' } },
        Effect.void,
        lookupRequest
      )
    )

    const record = only()
    expect(record.message).toBe('capability.global')
    // The marker is the point: a missed join shows up in the log stream instead
    // of looking like a normal second event.
    expect(record.annotations).toMatchObject({
      service: 'web',
      scope: 'standalone',
      workspaceSlug: 'acme',
      status: 'ok'
    })
  })
})
