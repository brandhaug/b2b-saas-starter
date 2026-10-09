import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { provisionLifecycleHost } from './lifecycle-harness'

it.live('cleans the idle authority schedule through the SDK alarm', () =>
  Effect.gen(function* () {
    const host = yield* provisionLifecycleHost('alarm-cleanup', expect)
    const completed = yield* host.complete()
    const before = yield* host.evidence()
    expect(before.schedules).toHaveLength(1)
    expect(before.schedules[0]).toMatchObject({ callback: 'revalidateAuthority' })
    expect(before.alarm).not.toBeNull()
    yield* host.runDueAlarm()
    expect((yield* host.evidence()).schedules).toEqual([])
    expect(yield* Effect.promise(() => runDurableObjectAlarm(host.stub))).toBe(false)
    expect(yield* host.history()).toEqual(completed)
    expect(host.providerRequests()).toBe(1)
  }).pipe(Effect.scoped)
)

it.live(
  'reconstructs completed output and joins repeated delivery after idle eviction',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionLifecycleHost('idle-reconstruction', expect)
      const completed = yield* host.complete()
      yield* host.runDueAlarm()
      const before = yield* host.evidence()
      const reservations = yield* host.reservations()
      expect(before.schedules).toEqual([])
      expect(before.alarm).toBeNull()
      expect(before.connections).toBe(0)
      expect(reservations).toHaveLength(1)
      expect(reservations[0]?.released_at).not.toBeNull()
      yield* Effect.promise(() => evictDurableObject(host.stub))
      expect(yield* host.history()).toEqual(completed)
      expect((yield* host.evidence()).instance).not.toBe(before.instance)
      expect((yield* host.send()).status).toBe(200)
      expect(yield* host.history()).toEqual(completed)
      expect(yield* host.reservations()).toEqual(reservations)
      expect(host.providerRequests()).toBe(1)
    }).pipe(Effect.scoped)
)
