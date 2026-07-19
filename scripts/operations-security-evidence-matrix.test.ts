import { describe, expect, it } from 'vitest'
import { buildOperationsReleasePlan } from './operations-security-evidence-matrix.ts'

describe('Operations release-matrix command', () => {
  it('runs each owning workspace once with unique mapped evidence', () => {
    const plan = buildOperationsReleasePlan()

    expect(plan.map((entry) => entry.workspace)).toEqual([
      'packages/capabilities',
      'apps/operations',
      'apps/merchant',
      'apps/background',
      'packages/auth',
      'scripts'
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
        .find((entry) => entry.workspace === 'packages/capabilities')
        ?.testFiles.includes(
          'src/governance/operations-security-evidence-matrix.test.ts'
        )
    ).toBe(true)
  })
})
