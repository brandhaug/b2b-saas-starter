import { sha256Identity } from './canonical-json.ts'

export type FixtureBundle = {
  readonly schemaVersion: 1
  readonly data: Readonly<Record<string, unknown>>
}

export type ScenarioClock = {
  readonly instant: string
  readonly timezone: string
}

export const scenarioJourneys = [
  'pay-in-person',
  'deliberate-blank',
  'selection-loading',
  'selection-error',
  'scheduling-available',
  'scheduling-empty',
  'scheduling-loading',
  'scheduling-unavailable',
  'scheduling-conflict',
  'scheduling-expiry-recovery',
  'group-booking',
  'pricing-quote',
  'quote-expired',
  'checkout-review',
  'online-payment',
  'cancellation-refund',
  'shell-boundary'
] as const

export type ScenarioJourney = (typeof scenarioJourneys)[number]

export type ScenarioManifestInput = {
  readonly schemaVersion: 1
  readonly id: string
  readonly fixture: FixtureBundle
  readonly clock: ScenarioClock
  readonly route: string
  readonly locale: 'en' | 'es' | 'fr' | 'ro'
  readonly embedding: 'standalone' | 'widget' | 'google'
  readonly viewport: { readonly width: number; readonly height: number }
  readonly providers: Readonly<Record<string, unknown>>
  readonly network: { readonly allow: readonly string[] }
  readonly assertions: readonly string[]
  readonly console: { readonly allow: readonly string[] }
  readonly journey: ScenarioJourney
}

export type ScenarioManifest = ScenarioManifestInput & {
  readonly fixtureIdentity: string
}

const exactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isValid = (value: unknown): value is ScenarioManifestInput => {
  if (!isRecord(value)) return false
  const fixture = value.fixture
  const clock = value.clock
  const viewport = value.viewport
  const network = value.network
  return (
    exactKeys(value, [
      'assertions',
      'clock',
      'console',
      'embedding',
      'fixture',
      'id',
      'journey',
      'locale',
      'network',
      'providers',
      'route',
      'schemaVersion',
      'viewport'
    ]) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    scenarioJourneys.includes(value.journey as ScenarioJourney) &&
    isRecord(fixture) &&
    exactKeys(fixture, ['data', 'schemaVersion']) &&
    fixture.schemaVersion === 1 &&
    isRecord(fixture.data) &&
    isRecord(clock) &&
    exactKeys(clock, ['instant', 'timezone']) &&
    typeof clock.instant === 'string' &&
    !Number.isNaN(Date.parse(clock.instant)) &&
    typeof clock.timezone === 'string' &&
    clock.timezone.length > 0 &&
    typeof value.route === 'string' &&
    value.route.startsWith('/') &&
    !value.route.startsWith('//') &&
    ['en', 'es', 'fr', 'ro'].includes(String(value.locale)) &&
    ['standalone', 'widget', 'google'].includes(String(value.embedding)) &&
    isRecord(viewport) &&
    exactKeys(viewport, ['height', 'width']) &&
    Number.isInteger(viewport.width) &&
    Number(viewport.width) > 0 &&
    Number.isInteger(viewport.height) &&
    Number(viewport.height) > 0 &&
    isRecord(value.providers) &&
    isRecord(value.console) &&
    exactKeys(value.console, ['allow']) &&
    Array.isArray(value.console.allow) &&
    value.console.allow.every((item) => typeof item === 'string') &&
    isRecord(network) &&
    exactKeys(network, ['allow']) &&
    Array.isArray(network.allow) &&
    network.allow.every(
      (origin) => typeof origin === 'string' && URL.canParse(origin)
    ) &&
    Array.isArray(value.assertions) &&
    value.assertions.every((item) => typeof item === 'string')
  )
}

export const fixtureBundleIdentity = (fixture: FixtureBundle): Promise<string> =>
  sha256Identity(fixture)

export const parseScenarioManifest = async (
  value: unknown
): Promise<ScenarioManifest> => {
  if (!isValid(value)) throw new Error('Invalid scenario manifest')
  return { ...value, fixtureIdentity: await fixtureBundleIdentity(value.fixture) }
}

export const defineScenario = parseScenarioManifest
