import { describe, expect, it } from 'vitest'
import {
  createCoverageReport,
  renderCoverageReport,
  validateParityLedger
} from './full-parity-ledger.ts'
import { fullParityLedger } from './full-parity-manifest.ts'

describe('full-parity contract ledger', () => {
  it('assigns every accepted inventory item exactly once', () => {
    const result = validateParityLedger(fullParityLedger)

    expect(result).toEqual({ valid: true, issues: [] })
    expect(new Set(fullParityLedger.inventory.map(({ id }) => id)).size).toBe(
      fullParityLedger.inventory.length
    )
    expect(
      new Set(fullParityLedger.entries.map(({ inventoryId }) => inventoryId)).size
    ).toBe(fullParityLedger.entries.length)
  })

  it.each([
    {
      name: 'missing assignments',
      ledger: {
        ...fullParityLedger,
        entries: fullParityLedger.entries.slice(1)
      },
      code: 'missing-entry'
    },
    {
      name: 'duplicate assignments',
      ledger: {
        ...fullParityLedger,
        entries: [...fullParityLedger.entries, fullParityLedger.entries[0]!]
      },
      code: 'duplicate-entry'
    },
    {
      name: 'orphaned assignments',
      ledger: {
        ...fullParityLedger,
        entries: [
          ...fullParityLedger.entries,
          {
            ...fullParityLedger.entries[0]!,
            inventoryId: 'route:removed-legacy-route'
          }
        ]
      },
      code: 'orphan-entry'
    }
  ])('rejects $name', ({ ledger, code }) => {
    const result = validateParityLedger(ledger)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code }))
  })

  it('reports zero unowned accepted entries', () => {
    expect(createCoverageReport(fullParityLedger)).toMatchObject({
      accepted: fullParityLedger.inventory.length,
      assigned: fullParityLedger.inventory.length,
      unowned: [],
      duplicateAssignments: [],
      orphanAssignments: []
    })
  })

  it('renders a reviewable coverage report for the repository command', () => {
    const report = renderCoverageReport(createCoverageReport(fullParityLedger))

    expect(report).toContain('# Full-Parity Contract Coverage')
    expect(report).toContain(
      `Accepted inventory items: ${fullParityLedger.inventory.length}`
    )
    expect(report).toContain('Unowned entries: 0')
    expect(report).toContain('Result: PASS')
  })
})
