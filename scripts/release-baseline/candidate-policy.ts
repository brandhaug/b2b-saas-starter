import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  validateParityLedger,
  type ParityLedger
} from '../../apps/booking/src/parity/full-parity-ledger.ts'
import { listFiles } from './files.ts'
import { productionIngress } from './ingress.ts'

export type CandidateIssue = { readonly code: string; readonly message: string }

const candidateSourceExtensions = /\.(?:md|mdx|ts|tsx)$/
const ignoredCandidateSource =
  /(?:\.test|\.browser\.test|\.stories|routeTree\.gen)\.|AGENTS\.md$/
const historicalDocumentation = /^docs\/(?:adr|agents|generated|research)\//
const teamBehaviorPatterns = [
  /Team Plan|name:\s*['"]Team['"]|plans? for teams/i,
  /additional Merchant Members?|member invitations?|invite staff/i,
  /Manager (?:or|and) Employee roles?|ownership transfer/i,
  /(?:list|add|create|invite|remove)Members?/i,
  /role\s*(?::|=)\s*['"](?:manager|employee)['"]/i,
  /label\s*(?::|=)\s*['"]Members['"][\s\S]{0,80}to\s*(?::|=)\s*['"]\/members['"]/i,
  /per-seat billing/i,
  /(?:upgrade (?:to )?|downgrade (?:from )?)Team|Team (?:upgrade|downgrade)|downgrade to Solo/i
] as const
const additionalProviderBehavior =
  /additional Provider|createProvider|addProvider|providerLimit|maxProviders/i
const providerChoiceBehavior = /selectProvider|chooseProvider|setProviderPreference/i

export const collectCandidateSourceIssues = async (
  root: string
): Promise<CandidateIssue[]> => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8')
  ) as {
    readonly name?: string
    readonly description?: string
    readonly homepage?: string
    readonly repository?: unknown
  }
  // Public content is candidate-facing. ADRs, research, migrations, and canonical
  // domain docs are historical/authoritative records where prohibited terms must
  // remain searchable rather than being rewritten as active product promises.
  const sources = [
    resolve(root, 'README.md'),
    ...(await listFiles(resolve(root, 'apps/web/content'))),
    ...(await listFiles(resolve(root, 'docs'))),
    ...(await listFiles(resolve(root, 'apps/web/src'))),
    ...(await listFiles(resolve(root, 'apps/merchant/src'))),
    ...(await listFiles(resolve(root, 'apps/booking/src'))),
    ...(await listFiles(resolve(root, 'apps/api/src'))),
    ...(await listFiles(resolve(root, 'apps/background/src'))),
    ...(await listFiles(resolve(root, 'packages/capabilities/src'))),
    ...(await listFiles(resolve(root, 'packages/db/src')))
  ].filter(
    (path) =>
      candidateSourceExtensions.test(path) &&
      !ignoredCandidateSource.test(path) &&
      !historicalDocumentation.test(relative(root, path))
  )
  const contents = await Promise.all(
    sources.map(async (path) => ({
      path: relative(root, path),
      text: await readFile(path, 'utf8').catch(() => '')
    }))
  )
  const issues: CandidateIssue[] = []
  const reportMatches = (
    code: string,
    pattern: RegExp,
    paths: (path: string) => boolean
  ) => {
    for (const source of contents) {
      if (paths(source.path) && pattern.test(source.text))
        issues.push({ code, message: `${source.path} contains ${pattern.source}` })
    }
  }

  if (
    packageJson.name !== 'beesolo' ||
    /starter/i.test(packageJson.description ?? '') ||
    /b2b-saas-starter/i.test(
      JSON.stringify([packageJson.homepage, packageJson.repository])
    )
  )
    issues.push({
      code: 'active-starter-identity',
      message: 'package.json exposes active starter product identity'
    })

  const publicProduct = (path: string) =>
    path === 'README.md' ||
    path.startsWith('docs/') ||
    path.startsWith('apps/web/content/') ||
    path.startsWith('apps/web/src/')
  const merchantProduct = (path: string) => path.startsWith('apps/merchant/src/')
  const bookingProduct = (path: string) => path.startsWith('apps/booking/src/')
  const coreProduct = (path: string) =>
    path.startsWith('apps/api/src/') ||
    path.startsWith('apps/background/src/') ||
    path.startsWith('packages/capabilities/src/') ||
    path.startsWith('packages/db/src/')
  const activeProduct = (path: string) =>
    publicProduct(path) || merchantProduct(path) || bookingProduct(path)
  reportMatches(
    'active-starter-identity',
    /B2B SaaS Starter|starter (?:template|monorepo|showcase|product)/i,
    activeProduct
  )
  reportMatches(
    'platform-api',
    /Platform API/i,
    (path) => publicProduct(path) || merchantProduct(path)
  )
  for (const pattern of teamBehaviorPatterns)
    reportMatches(
      'team-behavior',
      pattern,
      (path) => publicProduct(path) || merchantProduct(path) || coreProduct(path)
    )
  reportMatches('team-behavior', additionalProviderBehavior, coreProduct)
  reportMatches(
    'provider-navigation',
    /label\s*(?::|=)\s*['"]Providers['"][\s\S]{0,80}to\s*(?::|=)\s*['"]\/providers['"]/i,
    merchantProduct
  )
  reportMatches(
    'provider-choice',
    /['"](?:Choose|Select) (?:a )?Provider['"]|['"]Any Provider['"]|providerCards\.anyProvider|showProviders\s*=|kind:\s*['"]specific['"][\s\S]{0,80}providerId/i,
    (path) => bookingProduct(path) || publicProduct(path)
  )
  reportMatches('provider-choice', providerChoiceBehavior, coreProduct)
  return issues
}

export const validateReleaseParity = (ledger: ParityLedger): CandidateIssue[] => {
  const forbiddenStatuses = new Set(['planned', 'waived'])
  const structuralIssues = validateParityLedger(ledger).issues.map((issue) => ({
    code: issue.code === 'missing-entry' ? 'unowned' : issue.code,
    message: issue.message
  }))
  return structuralIssues.concat(
    ledger.entries.flatMap((entry) => {
      const issues: CandidateIssue[] = []
      if (!entry.owner.trim())
        issues.push({ code: 'unowned', message: `${entry.inventoryId} has no owner` })
      if (forbiddenStatuses.has(entry.status))
        issues.push({
          code: entry.status,
          message: `${entry.inventoryId} is ${entry.status}; release evidence must be verified or intentionally removed`
        })
      if (/placeholder|skip(?:ped)?|starter/i.test(entry.scenario))
        issues.push({
          code: 'placeholder-evidence',
          message: `${entry.inventoryId} uses non-release evidence ${entry.scenario}`
        })
      return issues
    })
  )
}

export const validateSoloCandidate = (parity: ParityLedger): CandidateIssue[] => {
  const issues = validateReleaseParity(parity)
  for (const ingress of productionIngress) {
    if ('candidateBlock' in ingress)
      issues.push({
        code: ingress.candidateBlock,
        message: `${ingress.pattern} is deferred beyond the Solo launch`
      })
  }
  return issues
}
