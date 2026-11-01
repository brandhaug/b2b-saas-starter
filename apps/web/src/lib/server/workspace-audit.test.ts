// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { UiError, uiErrorAdapter } from '../ui-error'
import { causeMessage } from '../cause-message'

import { fixtureSession } from '@/test/fixture-session'
import { loadWorkspaceAuditEventsHandler } from './workspace-audit.effects'
import { zonedDayBoundary as zonedDayBoundaryEffect } from './zoned-day-boundary'
import { withPresentation } from './i18n-context'
import { type WorkspaceAuditFilters } from './workspace-audit'
import type * as AuthModule from './auth'

/**
 * The loader through its handler, against the Seed layer: the session gate
 * is answered by the mock with the fixture identity under test. The seed
 * audit fixture has one workspace-scoped event (`aud_token`,
 * `starter-lab`) and one system-level event with no workspace (`aud_admin`)
 * — which is what makes the scoping assertions below possible.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => {
  const { Effect: AuthEffect } = await import('effect')
  return {
    ...(await importOriginal<typeof AuthModule>()),
    requireRequestSession: async () => fixtureSession(actor),
    requireRequestSessionEffect: () => AuthEffect.succeed(fixtureSession(actor))
  }
})

function load(overrides?: {
  readonly filters?: WorkspaceAuditFilters
  readonly cursor?: string
}) {
  return loadWorkspaceAuditEventsHandler({
    workspaceSlug: 'starter-lab',
    filters: overrides?.filters ?? {},
    ...(overrides?.cursor !== undefined && { cursor: overrides.cursor })
  })
}

describe('loadWorkspaceAuditEventsHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  // Failure modes: skipped-day conversion escapes the typed runner, exposes
  // diagnostics over SSR, or advanced date filters miss the same refusal.
  it.each(['since', 'until', 'view'] as const)(
    'serializes a safe calendar refusal for %s and recovers with cleared filters',
    async (field) => {
      const input = {
        workspaceSlug: 'starter-lab',
        filters: field === 'view' ? {} : { [field]: '2011-12-30' },
        ...(field === 'view' && {
          view: {
            match: 'all' as const,
            filters: [
              {
                field: 'createdAt' as const,
                operator: 'is' as const,
                value: '2011-12-30'
              }
            ],
            sorts: []
          }
        })
      }
      await withPresentation(
        { timeZone: 'Pacific/Apia', authenticated: true, needsTimeZone: false },
        async () => {
          const error = await loadWorkspaceAuditEventsHandler(input).catch(
            (error_: unknown) => error_
          )
          expect(error).toBeInstanceOf(UiError)
          if (!(error instanceof UiError)) {
            return
          }
          const wire = uiErrorAdapter.toSerializable(error)
          expect(wire).toEqual({
            code: 'invalid_calendar_day',
            details: {},
            name: 'UiError'
          })
          expect(
            causeMessage(uiErrorAdapter.fromSerializable(wire), 'Unexpected')
          ).toBe(
            'A date filter is invalid or does not exist in your time zone. Clear the filters and choose another date.'
          )
          const recovered = await load()
          expect(recovered.events.length).toBeGreaterThan(0)
        }
      )
    }
  )

  it('gives an owner the workspace-scoped events, newest first', async () => {
    const payload = await load()
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.events.length).toBeGreaterThan(0)
    for (const event of payload.events) {
      // Only this workspace's events — the system-level row stays out.
      expect(event.id).not.toBe('aud_admin')
    }
    const times = payload.events.map((event) => event.createdAt)
    expect(times.toReversed()).toEqual([...times].toSorted())
    // An audit reader also holds the member list, so the actor filter keys on ids.
    expect(payload.members.map((member) => member.id)).toContain('usr_demo')
  })

  it('filters by event type server-side', async () => {
    const payload = await load({
      filters: { eventType: 'api_token.created' }
    })
    expect(payload.filters).toEqual({ eventType: 'api_token.created' })
    expect(payload.events.map((event) => event.eventType)).toEqual([
      'api_token.created'
    ])
  })

  it('returns an empty page for a filter nothing matches', async () => {
    const payload = await load({ filters: { eventType: 'auth.sign_in' } })
    expect(payload.events).toEqual([])
    expect(payload.nextCursor).toBeNull()
  })

  it('echoes the date-range filters back for the controls', async () => {
    const payload = await load({
      filters: { since: '2026-05-01', until: '2026-05-31' }
    })
    expect(payload.filters.since).toBe('2026-05-01')
    expect(payload.filters.until).toBe('2026-05-31')
    // The fixture's token event falls inside May 2026.
    expect(payload.events.map((event) => event.id)).toContain('aud_token')
  })

  it('reads a day filter as the account zone, not as UTC', async () => {
    // `aud_token` is 2026-05-14T08:20Z, which is the 13th at 22:20 in
    // Honolulu. Widening to UTC bounds would drop it from the day the page
    // renders it on.
    const payload = await withPresentation(
      { timeZone: 'Pacific/Honolulu', authenticated: true, needsTimeZone: false },
      () => load({ filters: { since: '2026-05-13', until: '2026-05-13' } })
    )
    expect(payload.events.map((event) => event.id)).toContain('aud_token')
  })

  it.each(['is', 'isNot'] satisfies ReadonlyArray<'is' | 'isNot'>)(
    'evaluates advanced date %s in the account zone and echoes the calendar value',
    async (operator) => {
      const view = {
        match: 'all',
        filters: [{ field: 'createdAt', operator, value: '2026-05-13' }],
        sorts: [{ field: 'createdAt', direction: 'desc' }]
      } satisfies NonNullable<
        Parameters<typeof loadWorkspaceAuditEventsHandler>[0]['view']
      >
      const payload = await withPresentation(
        { timeZone: 'Pacific/Honolulu', authenticated: true, needsTimeZone: false },
        () =>
          loadWorkspaceAuditEventsHandler({
            workspaceSlug: 'starter-lab',
            filters: {},
            view
          })
      )
      expect(payload.view).toEqual(view)
      expect(payload.events.some((event) => event.id === 'aud_token')).toBe(
        operator === 'is'
      )
    }
  )

  it('keeps the same event on its Oslo day', async () => {
    const payload = await withPresentation(
      { timeZone: 'Europe/Oslo', authenticated: true, needsTimeZone: false },
      () => load({ filters: { since: '2026-05-14', until: '2026-05-14' } })
    )
    expect(payload.events.map((event) => event.id)).toContain('aud_token')
  })
})

/**
 * The wire contract is instants, the controls speak calendar days, and the
 * page renders in the request's presentation zone. The boundary conversion is
 * where those three meet.
 */
function zonedDayBoundary(...args: Parameters<typeof zonedDayBoundaryEffect>) {
  return Effect.runSync(zonedDayBoundaryEffect(...args))
}

describe('zonedDayBoundary', () => {
  it('returns nonexistent days in the typed failure channel', () => {
    const result = Effect.runSync(
      Effect.result(zonedDayBoundaryEffect('2011-12-30', 'start', 'Pacific/Apia'))
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'InvalidCalendarDay' }
    })
  })

  // Failure modes: missing dates spill into adjacent days; midnight gaps,
  // repeated midnights, and non-hour DST changes truncate valid dates.
  it.each(['start', 'end'] as const)('rejects nonexistent days at %s', (edge) => {
    expect(() => zonedDayBoundary('2011-12-30', edge, 'Pacific/Apia')).toThrow(
      'Calendar day does not exist in the time zone'
    )
    expect(() => zonedDayBoundary('2026-02-30', edge, 'UTC')).toThrow(
      'Invalid calendar day'
    )
    expect(() => zonedDayBoundary('invalid', edge, 'UTC')).toThrow(
      'Invalid calendar day'
    )
  })

  it.each([
    [
      '2018-11-04',
      'America/Sao_Paulo',
      '2018-11-04T03:00:00.000Z',
      '2018-11-05T01:59:59.999Z'
    ],
    [
      '2020-11-01',
      'America/Havana',
      '2020-11-01T04:00:00.000Z',
      '2020-11-02T04:59:59.999Z'
    ],
    [
      '2026-10-04',
      'Australia/Lord_Howe',
      '2026-10-03T13:30:00.000Z',
      '2026-10-04T12:59:59.999Z'
    ],
    [
      '2011-12-29',
      'Pacific/Apia',
      '2011-12-29T10:00:00.000Z',
      '2011-12-30T09:59:59.999Z'
    ]
  ])('includes all instants of %s in %s', (day, zone, start, end) => {
    expect(zonedDayBoundary(day, 'start', zone)).toBe(start)
    expect(zonedDayBoundary(day, 'end', zone)).toBe(end)
  })

  it('widens a day to the zone offset in force that day', () => {
    expect(zonedDayBoundary('2026-05-14', 'start', 'Europe/Oslo')).toBe(
      '2026-05-13T22:00:00.000Z'
    )
    expect(zonedDayBoundary('2026-05-14', 'end', 'Europe/Oslo')).toBe(
      '2026-05-14T21:59:59.999Z'
    )
    // Winter is one hour east of summer in the same zone.
    expect(zonedDayBoundary('2026-01-14', 'start', 'Europe/Oslo')).toBe(
      '2026-01-13T23:00:00.000Z'
    )
    expect(zonedDayBoundary('2026-05-14', 'start', 'UTC')).toBe(
      '2026-05-14T00:00:00.000Z'
    )
  })

  it('settles a day that contains a DST transition', () => {
    // Oslo springs forward on 2026-03-29 and falls back on 2026-10-25, so
    // each of those days starts and ends at a different offset.
    expect(zonedDayBoundary('2026-03-29', 'start', 'Europe/Oslo')).toBe(
      '2026-03-28T23:00:00.000Z'
    )
    expect(zonedDayBoundary('2026-03-29', 'end', 'Europe/Oslo')).toBe(
      '2026-03-29T21:59:59.999Z'
    )
    expect(zonedDayBoundary('2026-10-25', 'start', 'Europe/Oslo')).toBe(
      '2026-10-24T22:00:00.000Z'
    )
    expect(zonedDayBoundary('2026-10-25', 'end', 'Europe/Oslo')).toBe(
      '2026-10-25T22:59:59.999Z'
    )
  })
})
