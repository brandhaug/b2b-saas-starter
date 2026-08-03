import { describe, expect, it } from 'vitest'
import { runScenarioTwice, type ScenarioDriver } from './evidence-runner.ts'
import { smokeScenarios } from './smoke-scenarios.ts'

describe('parity evidence runner seam', () => {
  it('captures complete evidence and proves clean-run hash stability', async () => {
    const scenario = smokeScenarios.find(
      (candidate) => candidate.motion.policy === 'sample-timeline'
    )!
    const driver: ScenarioDriver = {
      run: async ({ scenario }) => {
        return {
          semanticAssertions: scenario.assertions.map((assertion) => ({
            assertion,
            passed: true
          })),
          screenshot: new TextEncoder().encode(`stable:${scenario.id}`),
          visualCheckpoints: Object.fromEntries(
            scenario.motion.checkpoints.map((checkpoint) => [
              `timeline-${checkpoint}ms.png`,
              new TextEncoder().encode(`timeline:${checkpoint}`)
            ])
          ),
          dom: '<main><h1>Book an appointment</h1></main>',
          accessibility: { role: 'main', name: 'Book an appointment' },
          console: [],
          requests: [
            { url: 'http://booking.test/acme/booking', method: 'GET', status: 200 }
          ],
          trace: new TextEncoder().encode('stable-trace'),
          canonicalState: { renderedScenario: scenario.id },
          mutationHistory: [{ sequence: 1, type: 'journey.loaded' }]
        }
      }
    }

    const result = await runScenarioTwice({
      scenario,
      driver
    })

    expect(result.stable).toBe(true)
    expect(result.first).toMatchObject({
      schemaVersion: 1,
      scenarioId: scenario.id,
      semanticAssertions: scenario.assertions.map((assertion) => ({
        assertion,
        passed: true
      })),
      console: [],
      mutationHistory: [{ sequence: 1, type: 'journey.loaded' }]
    })
    expect(result.first.screenshotHash).toBe(result.second.screenshotHash)
    expect(result.first.visualCheckpointHashes).toEqual(
      result.second.visualCheckpointHashes
    )
    expect(new Set(Object.values(result.first.visualCheckpointHashes)).size).toBe(
      scenario.motion.checkpoints.length
    )
    expect(result.first.canonicalStateHash).toBe(result.second.canonicalStateHash)
  })

  it('rejects a timeline run that omits declared checkpoints', async () => {
    const scenario = smokeScenarios.find(
      (candidate) => candidate.motion.policy === 'sample-timeline'
    )!
    const driver: ScenarioDriver = {
      run: async () => ({
        semanticAssertions: scenario.assertions.map((assertion) => ({
          assertion,
          passed: true
        })),
        screenshot: new Uint8Array(),
        dom: '<main />',
        accessibility: '',
        console: [],
        requests: [],
        trace: new Uint8Array(),
        canonicalState: {},
        mutationHistory: []
      })
    }

    await expect(runScenarioTwice({ scenario, driver })).rejects.toThrow(
      /motion checkpoint evidence mismatch/i
    )
  })

  it('fails when the driver makes an undeclared request', async () => {
    const driver: ScenarioDriver = {
      run: async ({ request }) => {
        request('https://analytics.example/events')
        throw new Error('unreachable')
      }
    }

    await expect(
      runScenarioTwice({
        scenario: smokeScenarios[0]!,
        driver
      })
    ).rejects.toThrow(/undeclared network request/i)
  })
})
