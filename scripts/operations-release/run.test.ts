import { describe, expect, it } from 'vitest'
import { buildOperationsReleasePlan } from './run.ts'

describe('Operations release-matrix command', () => {
  it('runs each owning workspace once with unique mapped evidence', () => {
    const plan = buildOperationsReleasePlan()

    expect(plan.map((entry) => entry.workspace)).toEqual([
      'scripts',
      'packages/capabilities',
      'apps/operations',
      'apps/merchant',
      'apps/background',
      'packages/auth'
    ])
    expect(
      plan.every(
        (entry) =>
          entry.testFiles.length > 0 &&
          new Set(entry.testFiles).size === entry.testFiles.length
      )
    ).toBe(true)
    expect(
      plan
        .find((entry) => entry.workspace === 'scripts')
        ?.testFiles.includes('operations-release/evidence-matrix.test.ts')
    ).toBe(true)
  })
})
