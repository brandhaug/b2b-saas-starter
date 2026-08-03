export const parityInventoryKinds = [
  'route',
  'journey',
  'state',
  'locale',
  'viewport',
  'embedding',
  'integration',
  'defect',
  'inferred-branch',
  'vocabulary',
  'module-boundary',
  'retirement'
] as const

export type ParityInventoryKind = (typeof parityInventoryKinds)[number]
export type ParityStatus = 'planned' | 'implemented' | 'verified' | 'waived'

export interface ParityInventoryItem {
  readonly id: string
  readonly kind: ParityInventoryKind
  readonly description: string
  readonly source: string
}

export interface ParityLedgerEntry {
  readonly inventoryId: string
  readonly owner: string
  readonly scenario: string
  readonly status: ParityStatus
  readonly waiver?: { readonly reason: string; readonly reviewer: string }
}

export interface ParityLedger {
  readonly version: 1
  readonly inventory: readonly ParityInventoryItem[]
  readonly entries: readonly ParityLedgerEntry[]
}

export interface LedgerIssue {
  readonly code:
    | 'duplicate-inventory'
    | 'missing-entry'
    | 'duplicate-entry'
    | 'orphan-entry'
    | 'invalid-entry'
    | 'invalid-waiver'
  readonly inventoryId: string
  readonly message: string
}

const duplicates = (values: readonly string[]) =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()

const analyzeLedgerReferences = (ledger: ParityLedger) => {
  const inventoryIds = ledger.inventory.map(({ id }) => id)
  const entryIds = ledger.entries.map(({ inventoryId }) => inventoryId)
  const inventorySet = new Set(inventoryIds)
  const entrySet = new Set(entryIds)

  return {
    inventoryIds,
    entryIds,
    inventorySet,
    entrySet,
    duplicateInventory: duplicates(inventoryIds),
    duplicateEntries: duplicates(entryIds),
    missingEntries: inventoryIds.filter((id) => !entrySet.has(id)).sort(),
    orphanEntries: entryIds.filter((id) => !inventorySet.has(id)).sort()
  }
}

export const validateParityLedger = (
  ledger: ParityLedger
): { readonly valid: boolean; readonly issues: readonly LedgerIssue[] } => {
  const analysis = analyzeLedgerReferences(ledger)
  const issues: LedgerIssue[] = []

  for (const inventoryId of analysis.duplicateInventory) {
    issues.push({
      code: 'duplicate-inventory',
      inventoryId,
      message: `Inventory item ${inventoryId} is declared more than once.`
    })
  }
  for (const inventoryId of analysis.missingEntries) {
    issues.push({
      code: 'missing-entry',
      inventoryId,
      message: `Accepted inventory item ${inventoryId} has no ledger entry.`
    })
  }
  for (const inventoryId of analysis.duplicateEntries) {
    issues.push({
      code: 'duplicate-entry',
      inventoryId,
      message: `Inventory item ${inventoryId} has more than one ledger entry.`
    })
  }
  for (const entry of ledger.entries) {
    if (!analysis.inventorySet.has(entry.inventoryId)) {
      issues.push({
        code: 'orphan-entry',
        inventoryId: entry.inventoryId,
        message: `Ledger entry ${entry.inventoryId} has no accepted inventory item.`
      })
    }
    if (!entry.owner.trim() || !entry.scenario.trim()) {
      issues.push({
        code: 'invalid-entry',
        inventoryId: entry.inventoryId,
        message: `Ledger entry ${entry.inventoryId} must name an owner and scenario.`
      })
    }
    if (
      entry.status === 'waived' &&
      (!entry.waiver?.reason.trim() || !entry.waiver.reviewer.trim())
    ) {
      issues.push({
        code: 'invalid-waiver',
        inventoryId: entry.inventoryId,
        message: `Waived entry ${entry.inventoryId} must name a reason and reviewer.`
      })
    }
  }

  return { valid: issues.length === 0, issues }
}

export const createCoverageReport = (ledger: ParityLedger) => {
  const analysis = analyzeLedgerReferences(ledger)

  return {
    version: ledger.version,
    accepted: analysis.inventoryIds.length,
    assigned: analysis.inventoryIds.filter((id) => analysis.entrySet.has(id)).length,
    byStatus: Object.fromEntries(
      (['planned', 'implemented', 'verified', 'waived'] as const).map((status) => [
        status,
        ledger.entries.filter((entry) => entry.status === status).length
      ])
    ),
    unowned: analysis.missingEntries,
    duplicateAssignments: analysis.duplicateEntries,
    orphanAssignments: analysis.orphanEntries
  }
}

export type ParityCoverageReport = ReturnType<typeof createCoverageReport>

export const renderCoverageReport = (report: ParityCoverageReport) => {
  const passed =
    report.unowned.length === 0 &&
    report.duplicateAssignments.length === 0 &&
    report.orphanAssignments.length === 0
  const statusRows = Object.entries(report.byStatus)
  const statusWidth = Math.max(
    'Status'.length,
    ...statusRows.map(([status]) => status.length)
  )
  const countWidth = Math.max(
    'Entries'.length,
    ...statusRows.map(([, count]) => `${count}`.length)
  )
  const statuses = statusRows
    .map(
      ([status, count]) =>
        `| ${status.padEnd(statusWidth)} | ${`${count}`.padStart(countWidth)} |`
    )
    .join('\n')

  return `# Full-Parity Contract Coverage

Generated from \`apps/booking/src/parity/full-parity-manifest.ts\`. Do not edit this report by hand.

- Accepted inventory items: ${report.accepted}
- Assigned entries: ${report.assigned}
- Unowned entries: ${report.unowned.length}
- Duplicate assignments: ${report.duplicateAssignments.length}
- Orphan assignments: ${report.orphanAssignments.length}
- Result: ${passed ? 'PASS' : 'FAIL'}

| ${'Status'.padEnd(statusWidth)} | ${'Entries'.padStart(countWidth)} |
| ${'-'.repeat(statusWidth)} | ${'-'.repeat(countWidth - 1)}: |
${statuses}
`
}
