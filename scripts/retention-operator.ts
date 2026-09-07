import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { LiveRetention } from '@b2b-saas-starter/capabilities/governance/retention.live'
import {
  approveRetentionPolicy,
  Retention,
  RetentionPolicy,
  RetentionResult as RetentionResultSchema,
  retentionPolicyDigest,
  retentionPolicyFromEnv,
  type RetentionPolicy as RetentionPolicyType,
  type RetentionResult,
  validateRetentionPolicy
} from '@b2b-saas-starter/capabilities/governance/retention'
import { RawD1, type D1Binding } from '@b2b-saas-starter/db/service'
import { Effect, Layer, Option, Schema } from 'effect'
import { getPlatformProxy } from 'wrangler'
import { retentionTargetKey } from '../infra/bindings.ts'

type Environment = Readonly<Record<string, string | undefined>>

const ROOT = join(import.meta.dirname, '..')
const LOCAL_CONFIG = join(ROOT, 'packages', 'db', 'wrangler.jsonc')
const LOCAL_PERSIST = join(ROOT, 'packages', 'db', '.wrangler', 'state', 'v3')
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000
const decodeStringOption = Schema.decodeUnknownOption(Schema.String)
const decodeFailureReason = Schema.decodeUnknownOption(
  Schema.Struct({ reason: Schema.String })
)
const decodeFailureMessage = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.String })
)

const Target = Schema.Struct({
  kind: Schema.Literals(['local', 'remote']),
  database: Schema.String,
  deployment: Schema.String,
  key: Schema.String
})
type Target = typeof Target.Type

const PreviewArtifact = Schema.Struct({
  schema: Schema.Literal(1),
  kind: Schema.Literal('retention-preview'),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  target: Target,
  policy: RetentionPolicy,
  policyDigest: Schema.String,
  result: RetentionResultSchema
})
type PreviewArtifact = typeof PreviewArtifact.Type
const decodePreviewArtifact = Schema.decodeUnknownSync(PreviewArtifact)

type PreviewOptions = {
  readonly command: 'preview'
  readonly target: Target
  readonly output?: string | undefined
}

type ApproveOptions = {
  readonly command: 'approve'
  readonly artifact: string
  readonly confirmation: string
  readonly targetConfirmation: string
  readonly recoveryEvidence: string
  readonly output?: string | undefined
}

type Options = PreviewOptions | ApproveOptions

type OpenedDatabase = {
  readonly d1: D1Binding
  readonly dispose: () => Promise<void>
}

export type OperatorDependencies = {
  readonly openDatabase?: (
    target: Target,
    environment: Environment
  ) => Promise<OpenedDatabase>
  readonly now?: () => Date
  readonly write?: (text: string) => void
}

function value(input: string | boolean | undefined): string | undefined {
  const decoded = Option.getOrUndefined(decodeStringOption(input))
  if (decoded === undefined) {
    return undefined
  }
  const normalized = decoded.trim()
  if (normalized.length === 0) {
    return undefined
  }
  return normalized
}

function required(input: string | undefined, label: string): string {
  if (input === undefined) {
    throw new Error(`Missing ${label}`)
  }
  return input
}

function parseCli(rawArgs: ReadonlyArray<string>): Options {
  const separator = rawArgs.indexOf('--')
  const args = separator === -1 ? rawArgs : rawArgs.slice(separator + 1)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      database: { type: 'string' },
      deployment: { type: 'string' },
      output: { type: 'string', short: 'o' },
      artifact: { type: 'string' },
      confirm: { type: 'string' },
      'confirm-target': { type: 'string' },
      'recovery-evidence': { type: 'string' }
    }
  })
  const command = parsed.positionals[0]
  const output = value(parsed.values.output)
  if (command === 'preview') {
    const local = parsed.values.local === true
    const remote = parsed.values.remote === true
    if (local === remote) {
      throw new Error('preview requires exactly one of --local or --remote')
    }
    if (local) {
      if (
        parsed.values.database !== undefined ||
        parsed.values.deployment !== undefined
      ) {
        throw new Error(
          'local preview uses the repository D1 and does not accept --database or --deployment'
        )
      }
      const database = 'b2b-saas-starter'
      const deployment = 'local'
      return {
        command,
        output,
        target: {
          kind: 'local',
          database,
          deployment,
          key: retentionTargetKey('local', deployment, database)
        }
      }
    }
    const database = required(value(parsed.values.database), '--database <D1 UUID>')
    const deployment = required(
      value(parsed.values.deployment),
      '--deployment <stage or database name>'
    )
    return {
      command,
      output,
      target: {
        kind: 'remote',
        database,
        deployment,
        key: retentionTargetKey('remote', deployment, database)
      }
    }
  }
  if (command === 'approve') {
    return {
      command,
      artifact: required(value(parsed.values.artifact), '--artifact <preview.json>'),
      confirmation: required(value(parsed.values.confirm), '--confirm <policy digest>'),
      targetConfirmation: required(
        value(parsed.values['confirm-target']),
        '--confirm-target <target key>'
      ),
      recoveryEvidence: required(
        value(parsed.values['recovery-evidence']),
        '--recovery-evidence <reference>'
      ),
      output
    }
  }
  throw new Error(
    'usage: retention-operator.ts preview (--local | --remote --database <D1 UUID> --deployment <name>) [--output <preview.json>] | approve --artifact <preview.json> --confirm <policy digest> --confirm-target <target key> --recovery-evidence <reference> [--output <approval.json>]'
  )
}

function previewPolicy(environment: Environment, target: Target) {
  const previewEnvironment = {
    ...environment,
    RETENTION_CLEANUP_ENABLED: 'false',
    RETENTION_RECOVERY_VERIFIED: 'false',
    RETENTION_POLICY_APPROVAL_DIGEST: undefined,
    RETENTION_PREVIEW_DIGEST: undefined,
    RETENTION_RECOVERY_EVIDENCE: undefined
  }
  return Effect.map(
    retentionPolicyFromEnv(previewEnvironment),
    (configured) =>
      ({
        version: configured.version,
        target: target.key,
        auditDays: configured.auditDays,
        notificationDays: configured.notificationDays,
        invitationDays: configured.invitationDays,
        tokenDays: configured.tokenDays,
        exportDays: configured.exportDays,
        billingDays: configured.billingDays,
        emailDays: configured.emailDays,
        unresolvedEmailDays: configured.unresolvedEmailDays,
        batchSize: configured.batchSize,
        workBudget: configured.workBudget,
        destructiveEnabled: false,
        recoveryVerified: false
      }) satisfies RetentionPolicyType
  )
}

function remoteEnvironment(environment: Environment): void {
  required(value(environment.CLOUDFLARE_ACCOUNT_ID), 'CLOUDFLARE_ACCOUNT_ID')
  required(value(environment.CLOUDFLARE_API_TOKEN), 'CLOUDFLARE_API_TOKEN')
}

async function openDatabase(
  target: Target,
  environment: Environment
): Promise<OpenedDatabase> {
  if (target.kind === 'local') {
    const proxy = await getPlatformProxy<{ DB: D1Binding }>({
      configPath: LOCAL_CONFIG,
      persist: { path: LOCAL_PERSIST },
      remoteBindings: false,
      envFiles: []
    })
    return { d1: proxy.env.DB, dispose: () => proxy.dispose() }
  }

  remoteEnvironment(environment)
  const directory = await mkdtemp(join(tmpdir(), 'retention-operator-'))
  const configPath = join(directory, 'wrangler.json')
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        name: 'b2b-saas-starter-retention-operator',
        compatibility_date: '2026-05-16',
        account_id: environment.CLOUDFLARE_ACCOUNT_ID,
        d1_databases: [
          {
            binding: 'DB',
            database_name: target.deployment,
            database_id: target.database,
            remote: true
          }
        ]
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  try {
    const proxy = await getPlatformProxy<{ DB: D1Binding }>({
      configPath,
      persist: false,
      remoteBindings: true,
      envFiles: []
    })
    return {
      d1: proxy.env.DB,
      dispose: async () => {
        await proxy.dispose()
        await rm(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function defaultPreviewPath(now: Date, target: Target): string {
  const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const name = target.key.replaceAll(/[^a-zA-Z0-9_-]/g, '_')
  return join(ROOT, '.context', `retention-preview-${name}-${timestamp}.json`)
}

async function writeJson(path: string, contents: unknown): Promise<string> {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
  return absolute
}

function runPreview(d1: D1Binding, policy: RetentionPolicyType, now: Date) {
  const layer = LiveRetention.pipe(Layer.provide(Layer.succeed(RawD1, d1)))
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* validateRetentionPolicy(policy)
      const retention = yield* Retention
      return yield* retention.run({ mode: 'preview', policy, now })
    }).pipe(Effect.provide(layer))
  )
}

function makeArtifact(
  now: Date,
  target: Target,
  policy: RetentionPolicyType,
  result: RetentionResult
): PreviewArtifact {
  if (result.mode !== 'preview' || result.status !== 'success') {
    throw new Error(`Retention preview failed (${result.failed} failed rule queries)`)
  }
  const policyDigest = retentionPolicyDigest(policy)
  return decodePreviewArtifact({
    schema: 1,
    kind: 'retention-preview',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
    target,
    policy,
    policyDigest,
    result
  })
}

function environmentForPolicy(policy: RetentionPolicyType) {
  return {
    RETENTION_POLICY_VERSION: policy.version,
    RETENTION_POLICY_TARGET: policy.target,
    RETENTION_AUDIT_DAYS: String(policy.auditDays),
    RETENTION_NOTIFICATION_DAYS: String(policy.notificationDays),
    RETENTION_INVITATION_DAYS: String(policy.invitationDays),
    RETENTION_TOKEN_DAYS: String(policy.tokenDays),
    RETENTION_EXPORT_DAYS: String(policy.exportDays),
    RETENTION_BILLING_DAYS: String(policy.billingDays),
    RETENTION_EMAIL_DAYS: String(policy.emailDays),
    RETENTION_UNRESOLVED_EMAIL_DAYS: String(policy.unresolvedEmailDays),
    RETENTION_BATCH_SIZE: String(policy.batchSize),
    RETENTION_WORK_BUDGET: String(policy.workBudget),
    RETENTION_CLEANUP_ENABLED: String(policy.destructiveEnabled),
    RETENTION_RECOVERY_VERIFIED: String(policy.recoveryVerified),
    RETENTION_POLICY_APPROVAL_DIGEST: required(
      policy.policyApprovalDigest,
      'approved policy digest'
    ),
    RETENTION_PREVIEW_DIGEST: required(policy.previewDigest, 'preview digest'),
    RETENTION_RECOVERY_EVIDENCE: required(
      policy.recoveryEvidenceRef,
      'recovery evidence reference'
    )
  }
}

function parseArtifact(contents: string): PreviewArtifact {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error('Preview artifact is not valid JSON')
  }
  return decodePreviewArtifact(parsed)
}

async function approve(
  options: ApproveOptions,
  now: Date
): Promise<Readonly<Record<string, unknown>>> {
  const artifact = parseArtifact(await readFile(resolve(options.artifact), 'utf8'))
  const createdAt = Date.parse(artifact.createdAt)
  const expiresAt = Date.parse(artifact.expiresAt)
  const evaluatedAt = Date.parse(artifact.result.evaluatedAt)
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(evaluatedAt) ||
    createdAt > now.getTime() ||
    evaluatedAt !== createdAt ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > PREVIEW_TTL_MS ||
    expiresAt <= now.getTime()
  ) {
    throw new Error('Preview artifact has expired or has an invalid approval window')
  }
  if (
    artifact.target.key !== artifact.policy.target ||
    options.targetConfirmation !== artifact.target.key
  ) {
    throw new Error('Preview target confirmation does not match the artifact target')
  }
  const digest = retentionPolicyDigest(artifact.policy)
  if (artifact.policyDigest !== digest || artifact.result.policyDigest !== digest) {
    throw new Error('Preview artifact policy digest does not match its policy')
  }
  const policy = await Effect.runPromise(
    approveRetentionPolicy({
      policy: artifact.policy,
      preview: artifact.result,
      confirmation: options.confirmation,
      recoveryEvidenceRef: options.recoveryEvidence
    })
  )
  return {
    schema: 1,
    kind: 'retention-policy-approval',
    approvedAt: now.toISOString(),
    target: artifact.target,
    preview: {
      createdAt: artifact.createdAt,
      expiresAt: artifact.expiresAt,
      policyDigest: artifact.policyDigest
    },
    environment: environmentForPolicy(policy)
  }
}

function errorMessage(error: unknown): string {
  const reason = Option.getOrUndefined(decodeFailureReason(error))?.reason
  if (reason !== undefined && reason.length > 0) {
    return reason
  }
  const message = Option.getOrUndefined(decodeFailureMessage(error))?.message
  if (message !== undefined && message.length > 0) {
    return message
  }
  return 'retention operator failed'
}

async function operate(
  rawArgs: ReadonlyArray<string>,
  environment: Environment,
  dependencies: OperatorDependencies = {}
): Promise<void> {
  const options = parseCli(rawArgs)
  const now = (dependencies.now ?? (() => new Date()))()
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError('Operator clock is invalid')
  }
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text))

  if (options.command === 'approve') {
    const approval = await approve(options, now)
    if (options.output === undefined) {
      write(`${JSON.stringify(approval, null, 2)}\n`)
      return
    }
    const output = await writeJson(options.output, approval)
    write(`${JSON.stringify({ approval: output, target: approval.target }, null, 2)}\n`)
    return
  }

  const policy = await Effect.runPromise(previewPolicy(environment, options.target))
  const opened = await (dependencies.openDatabase ?? openDatabase)(
    options.target,
    environment
  )
  try {
    const result = await runPreview(opened.d1, policy, now)
    const artifact = makeArtifact(now, options.target, policy, result)
    const output = await writeJson(
      options.output ?? defaultPreviewPath(now, options.target),
      artifact
    )
    write(
      `${JSON.stringify(
        {
          artifact: output,
          target: artifact.target,
          policyDigest: artifact.policyDigest,
          expiresAt: artifact.expiresAt,
          candidates: artifact.result.candidates,
          backlog: artifact.result.backlog
        },
        null,
        2
      )}\n`
    )
  } finally {
    await opened.dispose()
  }
}

export async function runOperator(
  rawArgs: ReadonlyArray<string>,
  environment: Environment,
  dependencies: OperatorDependencies = {}
): Promise<void> {
  try {
    await operate(rawArgs, environment, dependencies)
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error })
  }
}

if (import.meta.main) {
  try {
    await runOperator(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}
