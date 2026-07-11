import { canonicalJson, sha256Bytes, sha256Identity } from './canonical-json.ts'
import { createNetworkPolicy } from './network-policy.ts'
import type { ScenarioManifest } from './scenario-manifest.ts'

export type DriverEvidence = {
  readonly semanticAssertions: readonly {
    readonly assertion: string
    readonly passed: boolean
  }[]
  readonly screenshot: Uint8Array
  readonly dom: string
  readonly accessibility: unknown
  readonly console: readonly { readonly type: string; readonly text: string }[]
  readonly requests: readonly {
    readonly url: string
    readonly method: string
    readonly status?: number
  }[]
  readonly trace: Uint8Array
  readonly canonicalState: unknown
  readonly mutationHistory: readonly unknown[]
  readonly artifacts?: Readonly<Record<string, string>>
}

export type ScenarioDriver = {
  readonly run: (context: {
    readonly scenario: ScenarioManifest
    readonly namespace: string
    readonly now: () => Date
    readonly timezone: string
    readonly request: (url: string) => void
  }) => Promise<DriverEvidence>
}

export type EvidenceBundle = {
  readonly schemaVersion: 1
  readonly scenarioId: string
  readonly fixtureIdentity: string
  readonly screenshotHash: string
  readonly canonicalStateHash: string
  readonly traceHash: string
  readonly semanticAssertions: DriverEvidence['semanticAssertions']
  readonly canonicalState: unknown
  readonly mutationHistory: readonly unknown[]
  readonly dom: string
  readonly accessibility: unknown
  readonly console: DriverEvidence['console']
  readonly requests: DriverEvidence['requests']
  readonly artifacts: Readonly<Record<string, string>>
}

const runOnce = async (input: {
  scenario: ScenarioManifest
  driver: ScenarioDriver
  namespace: string
}): Promise<EvidenceBundle> => {
  const { scenario } = input
  const policy = createNetworkPolicy({ allow: scenario.network.allow })
  const driverEvidence = await input.driver.run({
    scenario,
    namespace: input.namespace,
    now: () => new Date(scenario.clock.instant),
    timezone: scenario.clock.timezone,
    request: (url) => policy.assertAllowed(url)
  })
  for (const request of driverEvidence.requests) policy.assertAllowed(request.url)
  return {
    schemaVersion: 1,
    scenarioId: scenario.id,
    fixtureIdentity: scenario.fixtureIdentity,
    screenshotHash: await sha256Bytes(driverEvidence.screenshot),
    canonicalStateHash: await sha256Identity(driverEvidence.canonicalState),
    traceHash: await sha256Bytes(driverEvidence.trace),
    semanticAssertions: driverEvidence.semanticAssertions,
    canonicalState: driverEvidence.canonicalState,
    mutationHistory: driverEvidence.mutationHistory,
    dom: driverEvidence.dom,
    accessibility: driverEvidence.accessibility,
    console: driverEvidence.console,
    requests: driverEvidence.requests,
    artifacts: driverEvidence.artifacts ?? {}
  }
}

export const runScenarioTwice = async (input: {
  readonly scenario: ScenarioManifest
  readonly driver: ScenarioDriver
}) => {
  const first = await runOnce({ ...input, namespace: `${input.scenario.id}:run-1` })
  const second = await runOnce({ ...input, namespace: `${input.scenario.id}:run-2` })
  const stable =
    first.screenshotHash === second.screenshotHash &&
    first.canonicalStateHash === second.canonicalStateHash
  if (
    !first.semanticAssertions.every(({ passed }) => passed) ||
    !second.semanticAssertions.every(({ passed }) => passed)
  ) {
    throw new Error(`Semantic assertions failed for ${input.scenario.id}`)
  }
  const errors = [...first.console, ...second.console].filter(
    ({ type, text }) =>
      type === 'error' &&
      !input.scenario.console.allow.some((allowed) => text.includes(allowed))
  )
  if (errors.length > 0) {
    throw new Error(
      `Browser console contains errors for ${input.scenario.id}: ${JSON.stringify(errors)}`
    )
  }
  return { first, second, stable, canonicalEvidence: canonicalJson(first) }
}
