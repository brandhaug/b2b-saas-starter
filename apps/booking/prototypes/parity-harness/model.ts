export const scenarios = [
  'happy-path',
  'empty-availability',
  'payment-failure'
] as const

export const viewports = [
  'mobile-touch-375x812',
  'iframe-375x700-in-768x900',
  'tablet-mouse-1024x768',
  'desktop-mouse-1440x900'
] as const

export const locales = ['en', 'es', 'fr', 'ro'] as const
export const motionPolicies = ['finish-and-freeze', 'sample-timeline'] as const
export const diffPolicies = ['exact', 'masked-antialiasing'] as const

type Scenario = (typeof scenarios)[number]
type Viewport = (typeof viewports)[number]
type Locale = (typeof locales)[number]
type MotionPolicy = (typeof motionPolicies)[number]
type DiffPolicy = (typeof diffPolicies)[number]

type Evidence = {
  screenshotHashMatches: boolean
  canonicalStateHashMatches: boolean
  interactionAssertionsPass: boolean
  metadataComplete: boolean
  undeclaredRequests: number
  consoleErrors: number
  secondRunStable: boolean
}

export type HarnessState = {
  manifest: {
    schemaVersion: 1
    scenario: Scenario
    fixtureVersion: string
    fixedInstant: string
    timezone: 'UTC'
    viewport: Viewport
    locale: Locale
    motion: MotionPolicy
    diff: DiffPolicy
    route: string
    actions: readonly string[]
  }
  evidence: Evidence
}

export type HarnessAction =
  | { type: 'cycle-scenario' }
  | { type: 'cycle-viewport' }
  | { type: 'cycle-locale' }
  | { type: 'cycle-motion' }
  | { type: 'cycle-diff' }
  | { type: 'toggle'; field: keyof Evidence }
  | { type: 'reset-evidence' }

const cycle = <T>(values: readonly T[], current: T): T =>
  values[(values.indexOf(current) + 1) % values.length]!

const scenarioContract = (scenario: Scenario) => {
  switch (scenario) {
    case 'happy-path':
      return {
        route: '/acme/services',
        actions: ['choose service', 'choose slot', 'enter details', 'confirm']
      }
    case 'empty-availability':
      return {
        route: '/acme/services/haircut/availability',
        actions: ['open fixed empty date', 'assert empty state']
      }
    case 'payment-failure':
      return {
        route: '/acme/checkout',
        actions: ['submit deterministic decline token', 'assert recoverable error']
      }
  }
}

export const initialState = (): HarnessState => ({
  manifest: {
    schemaVersion: 1,
    scenario: 'happy-path',
    fixtureVersion: 'booking-v1@sha256:demo',
    fixedInstant: '2026-02-16T10:00:00.000Z',
    timezone: 'UTC',
    viewport: 'mobile-touch-375x812',
    locale: 'en',
    motion: 'finish-and-freeze',
    diff: 'exact',
    ...scenarioContract('happy-path')
  },
  evidence: {
    screenshotHashMatches: true,
    canonicalStateHashMatches: true,
    interactionAssertionsPass: true,
    metadataComplete: true,
    undeclaredRequests: 0,
    consoleErrors: 0,
    secondRunStable: true
  }
})

export const reduceHarness = (
  state: HarnessState,
  action: HarnessAction
): HarnessState => {
  if (action.type === 'reset-evidence') {
    return { ...state, evidence: initialState().evidence }
  }

  if (action.type === 'toggle') {
    const value = state.evidence[action.field]
    return {
      ...state,
      evidence: {
        ...state.evidence,
        [action.field]: typeof value === 'boolean' ? !value : value === 0 ? 1 : 0
      }
    }
  }

  const manifest = { ...state.manifest }
  switch (action.type) {
    case 'cycle-scenario': {
      const scenario = cycle(scenarios, manifest.scenario)
      return {
        ...state,
        manifest: { ...manifest, scenario, ...scenarioContract(scenario) }
      }
    }
    case 'cycle-viewport':
      manifest.viewport = cycle(viewports, manifest.viewport)
      break
    case 'cycle-locale':
      manifest.locale = cycle(locales, manifest.locale)
      break
    case 'cycle-motion':
      manifest.motion = cycle(motionPolicies, manifest.motion)
      break
    case 'cycle-diff':
      manifest.diff = cycle(diffPolicies, manifest.diff)
      break
  }
  return { ...state, manifest }
}

export const verdict = (state: HarnessState) => {
  const failures: string[] = []
  const { evidence, manifest } = state

  if (!evidence.screenshotHashMatches) failures.push('visual output differs')
  if (!evidence.canonicalStateHashMatches) failures.push('canonical API state differs')
  if (!evidence.interactionAssertionsPass) failures.push('interaction contract differs')
  if (!evidence.metadataComplete) failures.push('evidence metadata is incomplete')
  if (evidence.undeclaredRequests > 0)
    failures.push('undeclared network access occurred')
  if (evidence.consoleErrors > 0) failures.push('browser console contains errors')
  if (!evidence.secondRunStable) failures.push('clean rerun is nondeterministic')
  if (
    manifest.diff === 'masked-antialiasing' &&
    manifest.motion === 'sample-timeline'
  ) {
    failures.push('timeline captures cannot use a broad antialiasing mask')
  }

  return { accepted: failures.length === 0, failures }
}
