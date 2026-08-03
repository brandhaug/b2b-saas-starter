import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createCoverageReport,
  renderCoverageReport,
  validateParityLedger
} from '../src/parity/full-parity-ledger.ts'
import { fullParityLedger } from '../src/parity/full-parity-manifest.ts'

const validation = validateParityLedger(fullParityLedger)
if (!validation.valid) {
  for (const issue of validation.issues) {
    process.stderr.write(`${issue.code}: ${issue.message}\n`)
  }
  process.exitCode = 1
} else {
  const report = renderCoverageReport(createCoverageReport(fullParityLedger))
  const reportDirectory = resolve(import.meta.dirname, '../../../docs/generated')
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(resolve(reportDirectory, 'full-parity-coverage.md'), report)
  process.stdout.write(report)
}
