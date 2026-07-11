import { describe, expect, it } from 'vitest'
import { createSeedHarnessController } from './seed-runtime.ts'
import { smokeScenarios } from './smoke-scenarios.ts'

const control = (path: string, secret: string, method = 'GET') =>
  new Request(`http://fixture.test${path}`, {
    method,
    headers: { authorization: `Bearer ${secret}` }
  })

describe('namespace-isolated capability fixture controls', () => {
  it('atomically resets and snapshots independent Seed capability graphs', async () => {
    const scenario = smokeScenarios[0]!
    const runA = createSeedHarnessController(scenario, 'run-a')
    const runB = createSeedHarnessController(scenario, 'run-b')
    const fallback = async () => new Response('fixture page')

    await Promise.all([
      runA.handle(
        new Request('http://fixture.test/mara-booking-studio/booking'),
        fallback
      ),
      runB.handle(
        new Request('http://fixture.test/mara-booking-studio/booking'),
        fallback
      )
    ])
    const before = await runA.handle(control('/__parity/snapshot', 'run-a'), fallback)
    await runA.handle(control('/__parity/reset', 'run-a', 'POST'), fallback)
    const after = await runA.handle(control('/__parity/snapshot', 'run-a'), fallback)
    const untouched = await runB.handle(
      control('/__parity/snapshot', 'run-b'),
      fallback
    )

    expect(((await before.json()) as { sessions: unknown[] }).sessions).toHaveLength(1)
    expect(((await after.json()) as { sessions: unknown[] }).sessions).toHaveLength(0)
    expect(((await untouched.json()) as { sessions: unknown[] }).sessions).toHaveLength(
      1
    )
  })

  it('keeps control state neutral without the namespace secret', async () => {
    const controller = createSeedHarnessController(smokeScenarios[0]!, 'secret')
    const result = await controller.handle(
      control('/__parity/snapshot', 'wrong'),
      async () => new Response('fallback')
    )
    expect(result.status).toBe(404)
  })

  it('fails undeclared server wall-clock reads while accepting injected instants', async () => {
    const controller = createSeedHarnessController(smokeScenarios[0]!, 'secret')
    const originalDate = Date
    globalThis.Date = new Proxy(Date, {
      construct(target, argumentsList) {
        if (argumentsList.length === 0) throw new Error('Undeclared wall-clock read')
        return Reflect.construct(target, argumentsList)
      },
      get(target, property, receiver) {
        if (property === 'now')
          return () => {
            throw new Error('Undeclared wall-clock read')
          }
        return Reflect.get(target, property, receiver)
      }
    }) as DateConstructor
    try {
      const response = await controller.handle(
        new Request('http://fixture.test/mara-booking-studio/booking'),
        async () => new Response('fixture page')
      )
      expect(response.status).toBe(303)
    } finally {
      globalThis.Date = originalDate
    }
  })
})
