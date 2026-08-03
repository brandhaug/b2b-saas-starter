import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  assertSeedBookingScenarioReleaseBaseline,
  buildSeedBookingScenario
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  collectCandidateSourceIssues,
  validateSoloCandidate
} from './candidate-policy.ts'
import {
  candidateConfigurationFiles,
  createCandidateManifest
} from './candidate-manifest.ts'
import { fullParityLedger } from '../../apps/booking/src/parity/full-parity-manifest.ts'

const root = resolve(import.meta.dirname, '../..')
assertSeedBookingScenarioReleaseBaseline(
  buildSeedBookingScenario('2026-07-10T09:30:00.000Z')
)
const issues = [
  ...validateSoloCandidate(fullParityLedger),
  ...(await collectCandidateSourceIssues(root))
]
if (issues.length) {
  for (const issue of issues) process.stderr.write(`${issue.code}: ${issue.message}\n`)
  process.exit(1)
}
const artifacts = process.argv.slice(2)
if (artifacts.length === 0) {
  process.stderr.write('artifacts: pass at least one built artifact path\n')
  process.exit(1)
}
const commit = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim()
const parityRevision = createHash('sha256')
  .update(
    await Bun.file(
      resolve(root, 'apps/booking/src/parity/full-parity-manifest.ts')
    ).arrayBuffer()
  )
  .digest('hex')
const manifest = await createCandidateManifest({
  root,
  commit,
  artifacts,
  parityRevision,
  configurationFiles: candidateConfigurationFiles
})
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
