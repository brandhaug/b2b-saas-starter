/**
 * Operator-only D1 backup and recovery commands.
 *
 * Backups leave Cloudflare only after AES-256-GCM encryption. A second
 * authenticated object is the completion record. Retention and freshness use
 * completion records, so an interrupted upload cannot displace a usable day.
 */
// This CLI coordinates Node child-process and timer promises outside the app runtime.
// oxlint-disable effect/noNewPromise
import { execFile } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'

import { Predicate, Schema } from 'effect'
import { isSecureDsn, isSecureEndpoint } from '../packages/env/src/transport.ts'
import { remoteDatabaseIdFromList } from '../packages/db/scripts/wrangler-d1.ts'
import { requiredEnv } from './internal/env.ts'

const exec = promisify(execFile)
const ROOT = join(import.meta.dirname, '..')
const DEFAULT_WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler')
const CONFIG = join(ROOT, 'apps', 'api', 'wrangler.jsonc')
const MAGIC = Buffer.from('D1BACKUP\0', 'ascii')
const COMPLETION_SUFFIX = '.complete.enc'
const BACKUP_WINDOW_MS = 60_000
const FRESHNESS_WINDOW_MS = 26 * 60 * 60 * 1000
export const RETENTION_DAYS = 30

const BackupEvidenceSchema = Schema.Struct({
  schema: Schema.Literal(1),
  database: Schema.String,
  objectKey: Schema.String,
  createdAt: Schema.String,
  completedAt: Schema.String,
  durationMs: Schema.Number,
  exportDurationMs: Schema.Number,
  exportBlockingBudgetMs: Schema.Number,
  exportWithinBudget: Schema.Boolean,
  plaintextBytes: Schema.Number,
  encryptedBytes: Schema.Number,
  sha256: Schema.String,
  retentionDays: Schema.Number
})
const decodeEvidence = Schema.decodeUnknownSync(BackupEvidenceSchema)

const S3ListingSchema = Schema.Struct({
  Contents: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        Key: Schema.String,
        LastModified: Schema.optionalKey(Schema.String)
      })
    )
  )
})
const decodeS3Listing = Schema.decodeUnknownSync(S3ListingSchema)

const DrillCountsSchema = Schema.Array(
  Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        tableCount: Schema.Number,
        userCount: Schema.Number,
        workspaceCount: Schema.Number,
        membershipCount: Schema.Number,
        sessionCount: Schema.Number,
        orphanMembershipCount: Schema.Number,
        orphanSessionCount: Schema.Number
      })
    )
  })
)
const decodeDrillCounts = Schema.decodeUnknownSync(DrillCountsSchema)

export type BackupEvidence = Schema.Schema.Type<typeof BackupEvidenceSchema>

type RestoreOptions = {
  drill?: boolean
  confirmTarget?: string
  database?: string
}

type SentryCheckInPayload = {
  check_in_id: string
  monitor_slug: string
  status: 'in_progress' | 'ok' | 'error'
  environment: string
  duration?: number
}

type S3Object = {
  readonly Key: string
  readonly LastModified?: string | undefined
}

export type CompletedBackup = {
  readonly evidence: BackupEvidence
  readonly completionKey: string
  readonly lastModified: string
}

type CommandOptions = {
  readonly maxBuffer?: number
  readonly env?: NodeJS.ProcessEnv
}

function keyFromEnvironment(): Buffer {
  const raw = requiredEnv(process.env, 'BACKUP_ENCRYPTION_KEY')
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return key
}

export function encryptBackup(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('backup key must be 32 bytes')
  }
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext])
}

export function decryptBackup(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < MAGIC.length + 12 + 16) {
    throw new Error('truncated backup')
  }
  if (payload.subarray(0, MAGIC.length).compare(MAGIC) !== 0) {
    throw new Error('invalid backup header')
  }
  const nonceStart = MAGIC.length
  const tagStart = nonceStart + 12
  const cipherStart = tagStart + 16
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    payload.subarray(nonceStart, tagStart)
  )
  decipher.setAuthTag(payload.subarray(tagStart, cipherStart))
  return Buffer.concat([
    decipher.update(payload.subarray(cipherStart)),
    decipher.final()
  ])
}

function wranglerBin(): string {
  return process.env.D1_BACKUP_WRANGLER_BIN ?? DEFAULT_WRANGLER
}

function awsBin(): string {
  return process.env.D1_BACKUP_AWS_BIN ?? 'aws'
}

async function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: CommandOptions = {}
): Promise<string> {
  const result = await exec(command, args, {
    cwd: ROOT,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    env: options.env ?? process.env
  })
  return result.stdout
}

async function retry(
  command: string,
  args: ReadonlyArray<string>,
  attempts = 3
): Promise<string> {
  try {
    return await runCommand(command, args)
  } catch (error) {
    if (attempts <= 1) {
      throw error
    }
    const delay = Number(process.env.D1_BACKUP_RETRY_DELAY_MS ?? '1000')
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delay)
    })
    return retry(command, args, attempts - 1)
  }
}

function s3Args(): ReadonlyArray<string> {
  const endpoint = process.env.BACKUP_S3_ENDPOINT
  if (endpoint === undefined) {
    return []
  }
  if (!isSecureEndpoint(endpoint)) {
    throw new Error(
      'BACKUP_S3_ENDPOINT must be an absolute HTTPS URL without credentials'
    )
  }
  return ['--endpoint-url', endpoint]
}

async function aws(args: ReadonlyArray<string>): Promise<string> {
  return retry(awsBin(), args)
}

function objectPrefix(database: string): string {
  return `${process.env.BACKUP_S3_PREFIX ?? 'd1'}/${database}/`
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function backupKeyPattern(database: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(objectPrefix(database))}\\d{8}T\\d{6}Z\\.sql\\.enc$`
  )
}

function completionKeyPattern(database: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(objectPrefix(database))}\\d{8}T\\d{6}Z\\.sql\\.enc${escapeRegExp(COMPLETION_SUFFIX)}$`
  )
}

function timestampFromObjectKey(database: string, objectKey: string): number {
  const stamp = objectKey.slice(objectPrefix(database).length, -'.sql.enc'.length)
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
  return Date.parse(iso)
}

async function listObjects(database: string): Promise<ReadonlyArray<S3Object>> {
  const raw = await aws([
    's3api',
    'list-objects-v2',
    '--bucket',
    requiredEnv(process.env, 'BACKUP_S3_BUCKET'),
    '--prefix',
    objectPrefix(database),
    ...s3Args(),
    '--output',
    'json'
  ])
  return decodeS3Listing(JSON.parse(raw)).Contents ?? []
}

function validateEvidence(
  evidence: BackupEvidence,
  database: string,
  objectKey: string
): void {
  const createdAt = Date.parse(evidence.createdAt)
  const completedAt = Date.parse(evidence.completedAt)
  const objectTimestamp = timestampFromObjectKey(database, objectKey)
  if (
    evidence.database !== database ||
    evidence.objectKey !== objectKey ||
    evidence.retentionDays !== RETENTION_DAYS ||
    !backupKeyPattern(database).test(objectKey) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(objectTimestamp) ||
    Math.abs(createdAt - objectTimestamp) >= 1000 ||
    completedAt < createdAt ||
    evidence.durationMs < 0 ||
    evidence.exportDurationMs < 0 ||
    evidence.exportBlockingBudgetMs !== BACKUP_WINDOW_MS ||
    evidence.plaintextBytes <= 0 ||
    evidence.encryptedBytes <= evidence.plaintextBytes ||
    !/^[0-9a-f]{64}$/.test(evidence.sha256)
  ) {
    throw new Error(`invalid completion evidence for ${objectKey}`)
  }
}

async function downloadObject(key: string, destination: string): Promise<void> {
  await aws([
    's3',
    'cp',
    `s3://${requiredEnv(process.env, 'BACKUP_S3_BUCKET')}/${key}`,
    destination,
    ...s3Args(),
    '--only-show-errors'
  ])
}

async function readCompletion(
  database: string,
  completion: S3Object,
  work: string,
  position: number
): Promise<CompletedBackup | undefined> {
  const objectKey = completion.Key.slice(0, -COMPLETION_SUFFIX.length)
  if (!completionKeyPattern(database).test(completion.Key)) {
    return undefined
  }
  const path = join(work, `completion-${position}.enc`)
  try {
    await downloadObject(completion.Key, path)
    const plaintext = decryptBackup(await readFile(path), keyFromEnvironment())
    const evidence = decodeEvidence(JSON.parse(plaintext.toString('utf8')))
    validateEvidence(evidence, database, objectKey)
    return {
      evidence,
      completionKey: completion.Key,
      lastModified: completion.LastModified ?? evidence.completedAt
    }
  } catch {
    return undefined
  }
}

async function completedBackups(
  database: string,
  work: string
): Promise<ReadonlyArray<CompletedBackup>> {
  const objects = await listObjects(database)
  const keys = new Set(objects.map((object) => object.Key))
  const completions = objects.filter(
    (object) =>
      completionKeyPattern(database).test(object.Key) &&
      keys.has(object.Key.slice(0, -COMPLETION_SUFFIX.length))
  )
  const decoded = await Promise.all(
    completions.map((completion, index) =>
      readCompletion(database, completion, work, index)
    )
  )
  return decoded.filter(Predicate.isNotUndefined)
}

export function retentionPlan(
  completed: ReadonlyArray<CompletedBackup>,
  retentionDays = RETENTION_DAYS
): ReadonlyArray<CompletedBackup> {
  const byDay = new Map<string, CompletedBackup>()
  for (const candidate of completed) {
    const day = candidate.evidence.createdAt.slice(0, 10)
    const previous = byDay.get(day)
    if (
      previous === undefined ||
      Date.parse(candidate.evidence.createdAt) > Date.parse(previous.evidence.createdAt)
    ) {
      byDay.set(day, candidate)
    }
  }
  const keep = new Set(
    [...byDay.entries()]
      .toSorted(([left], [right]) => right.localeCompare(left))
      .slice(0, retentionDays)
      .map(([, candidate]) => candidate.evidence.objectKey)
  )
  return completed.filter((candidate) => !keep.has(candidate.evidence.objectKey))
}

async function remoteDatabaseId(database: string): Promise<string> {
  const raw = await retry(wranglerBin(), ['d1', 'list', '--json', `--config=${CONFIG}`])
  return remoteDatabaseIdFromList(raw, database)
}

export async function backup(
  database = process.env.BACKUP_DATABASE ?? 'b2b-saas-starter'
): Promise<BackupEvidence> {
  requiredEnv(process.env, 'BACKUP_S3_BUCKET')
  const key = keyFromEnvironment()
  const started = Date.now()
  const work = await mkdtemp(join(tmpdir(), 'd1-backup-'))
  try {
    const dump = join(work, 'database.sql')
    const databaseId = await remoteDatabaseId(database)
    const exportStarted = Date.now()
    await retry(wranglerBin(), [
      'd1',
      'export',
      databaseId,
      '--remote',
      `--config=${CONFIG}`,
      `--output=${dump}`
    ])
    const exportDurationMs = Date.now() - exportStarted
    const plaintext = await readFile(dump)
    if (plaintext.length === 0) {
      throw new Error('Wrangler produced an empty D1 export')
    }
    const encrypted = encryptBackup(plaintext, key)
    const createdAt = new Date().toISOString()
    const stamp = createdAt
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z')
    const objectKey = `${objectPrefix(database)}${stamp}.sql.enc`
    const encryptedPath = join(work, 'database.sql.enc')
    await writeFile(encryptedPath, encrypted, { mode: 0o600 })
    await aws([
      's3',
      'cp',
      encryptedPath,
      `s3://${requiredEnv(process.env, 'BACKUP_S3_BUCKET')}/${objectKey}`,
      ...s3Args(),
      '--only-show-errors'
    ])
    await aws([
      's3api',
      'head-object',
      '--bucket',
      requiredEnv(process.env, 'BACKUP_S3_BUCKET'),
      '--key',
      objectKey,
      ...s3Args()
    ])
    const completedAt = new Date().toISOString()
    const evidence: BackupEvidence = {
      schema: 1,
      database,
      objectKey,
      createdAt,
      completedAt,
      durationMs: Date.now() - started,
      exportDurationMs,
      exportBlockingBudgetMs: BACKUP_WINDOW_MS,
      exportWithinBudget: exportDurationMs <= BACKUP_WINDOW_MS,
      plaintextBytes: plaintext.length,
      encryptedBytes: encrypted.length,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      retentionDays: RETENTION_DAYS
    }
    const completionPath = join(work, 'completion.enc')
    await writeFile(
      completionPath,
      encryptBackup(Buffer.from(JSON.stringify(evidence)), key),
      { mode: 0o600 }
    )
    const completionKey = `${objectKey}${COMPLETION_SUFFIX}`
    await aws([
      's3',
      'cp',
      completionPath,
      `s3://${requiredEnv(process.env, 'BACKUP_S3_BUCKET')}/${completionKey}`,
      ...s3Args(),
      '--only-show-errors'
    ])
    await aws([
      's3api',
      'head-object',
      '--bucket',
      requiredEnv(process.env, 'BACKUP_S3_BUCKET'),
      '--key',
      completionKey,
      ...s3Args()
    ])
    await prune(database)
    console.log(JSON.stringify(evidence))
    if (!evidence.exportWithinBudget) {
      throw new Error(
        `D1 export blocked requests for ${exportDurationMs}ms, exceeding the ${BACKUP_WINDOW_MS}ms budget`
      )
    }
    return evidence
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function prune(
  database = process.env.BACKUP_DATABASE ?? 'b2b-saas-starter'
): Promise<number> {
  requiredEnv(process.env, 'BACKUP_S3_BUCKET')
  const work = await mkdtemp(join(tmpdir(), 'd1-prune-'))
  try {
    const expired = retentionPlan(await completedBackups(database, work))
    await Promise.all(
      expired.flatMap((candidate) =>
        [candidate.evidence.objectKey, candidate.completionKey].map((key) =>
          aws([
            's3api',
            'delete-object',
            '--bucket',
            requiredEnv(process.env, 'BACKUP_S3_BUCKET'),
            '--key',
            key,
            ...s3Args()
          ])
        )
      )
    )
    return expired.length
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function verifyBackup(candidate: CompletedBackup, work: string): Promise<Buffer> {
  const encryptedPath = join(work, 'backup.sql.enc')
  await downloadObject(candidate.evidence.objectKey, encryptedPath)
  const plaintext = decryptBackup(await readFile(encryptedPath), keyFromEnvironment())
  const sha256 = createHash('sha256').update(plaintext).digest('hex')
  if (sha256 !== candidate.evidence.sha256) {
    throw new Error('backup evidence hash mismatch')
  }
  return plaintext
}

export async function freshness(
  database = process.env.BACKUP_DATABASE ?? 'b2b-saas-starter'
): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), 'd1-freshness-'))
  try {
    const completed = await completedBackups(database, work)
    const candidates = completed.toSorted(
      (left, right) =>
        timestampFromObjectKey(database, right.evidence.objectKey) -
        timestampFromObjectKey(database, left.evidence.objectKey)
    )
    const latest = candidates[0]
    if (
      latest === undefined ||
      Date.now() - Date.parse(latest.evidence.completedAt) > FRESHNESS_WINDOW_MS
    ) {
      throw new Error('no completed D1 backup exists within 26 hours')
    }
    const plaintext = await verifyBackup(latest, work)
    console.log(
      JSON.stringify({
        database,
        objectKey: latest.evidence.objectKey,
        completedAt: latest.evidence.completedAt,
        ageMs: Date.now() - Date.parse(latest.evidence.completedAt),
        verifiedBytes: plaintext.length,
        exportDurationMs: latest.evidence.exportDurationMs,
        exportWithinBudget: latest.evidence.exportWithinBudget
      })
    )
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

function isolatedWranglerEnvironment(work: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? join(work, 'wrangler.log')
  }
}

async function verifyLocalRestore(
  persist: string,
  work: string
): Promise<Record<string, number>> {
  const common = [
    'd1',
    'execute',
    'DB',
    '--local',
    `--config=${CONFIG}`,
    `--persist-to=${persist}`,
    '--json'
  ]
  const environment = isolatedWranglerEnvironment(work)
  const countsOutput = await runCommand(
    wranglerBin(),
    [
      ...common,
      "--command=SELECT (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table') AS tableCount, (SELECT COUNT(*) FROM user) AS userCount, (SELECT COUNT(*) FROM organization) AS workspaceCount, (SELECT COUNT(*) FROM member) AS membershipCount, (SELECT COUNT(*) FROM session) AS sessionCount, (SELECT COUNT(*) FROM member AS m LEFT JOIN user AS u ON u.id = m.userId LEFT JOIN organization AS o ON o.id = m.organizationId WHERE u.id IS NULL OR o.id IS NULL) AS orphanMembershipCount, (SELECT COUNT(*) FROM session AS s LEFT JOIN user AS u ON u.id = s.userId WHERE u.id IS NULL) AS orphanSessionCount"
    ],
    { env: environment }
  )
  const counts = decodeDrillCounts(JSON.parse(countsOutput))[0]?.results[0]
  if (
    counts === undefined ||
    counts.tableCount === 0 ||
    counts.orphanMembershipCount !== 0 ||
    counts.orphanSessionCount !== 0
  ) {
    throw new Error('restored database failed application integrity checks')
  }
  return counts
}

export async function restore(
  input: string,
  options: RestoreOptions = {}
): Promise<void> {
  const key = keyFromEnvironment()
  const work = await mkdtemp(join(tmpdir(), 'd1-restore-'))
  try {
    const encryptedPath = join(work, 'database.sql.enc')
    if (input.startsWith('s3://')) {
      await aws(['s3', 'cp', input, encryptedPath, ...s3Args(), '--only-show-errors'])
    } else {
      await writeFile(encryptedPath, await readFile(input), { mode: 0o600 })
    }
    const sql = decryptBackup(await readFile(encryptedPath), key)
    if (sql.length === 0 || !sql.includes('CREATE TABLE')) {
      throw new Error('backup does not contain a D1 schema')
    }
    const sqlPath = join(work, 'database.sql')
    await writeFile(sqlPath, sql, { mode: 0o600 })
    const database =
      options.database ?? process.env.BACKUP_DATABASE ?? 'b2b-saas-starter'
    if (options.drill) {
      const persist = join(work, 'isolated-d1')
      const environment = isolatedWranglerEnvironment(work)
      await runCommand(
        wranglerBin(),
        [
          'd1',
          'execute',
          'DB',
          '--local',
          `--config=${CONFIG}`,
          `--persist-to=${persist}`,
          `--file=${sqlPath}`
        ],
        { env: environment }
      )
      const counts = await verifyLocalRestore(persist, work)
      console.log(
        JSON.stringify({
          drill: true,
          database,
          isolatedStoreRemoved: true,
          verifiedBytes: sql.length,
          integrity: 'application_checks_passed',
          ...counts
        })
      )
      return
    }
    const expectedTarget = `${requiredEnv(process.env, 'CLOUDFLARE_ACCOUNT_ID')}/${database}`
    if (options.confirmTarget !== expectedTarget) {
      throw new Error(`remote restore requires --confirm-target=${expectedTarget}`)
    }
    const databaseId = await remoteDatabaseId(database)
    await runCommand(wranglerBin(), [
      'd1',
      'execute',
      databaseId,
      '--remote',
      `--config=${CONFIG}`,
      `--file=${sqlPath}`
    ])
    console.log(JSON.stringify({ drill: false, database, restoredBytes: sql.length }))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function pitrDrill(
  database: string,
  timestamp: string,
  confirmTarget: string | undefined
): Promise<void> {
  const production = process.env.BACKUP_DATABASE ?? 'b2b-saas-starter'
  if (database === production) {
    throw new Error('PITR drills refuse the configured production database')
  }
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError('--timestamp must be an ISO-8601 timestamp')
  }
  const expectedTarget = `${requiredEnv(process.env, 'CLOUDFLARE_ACCOUNT_ID')}/${database}`
  if (confirmTarget !== expectedTarget) {
    throw new Error(`PITR drill requires --confirm-target=${expectedTarget}`)
  }
  const databaseId = await remoteDatabaseId(database)
  await runCommand(wranglerBin(), [
    'd1',
    'time-travel',
    'restore',
    databaseId,
    `--config=${CONFIG}`,
    `--timestamp=${timestamp}`,
    '--json'
  ])
  console.log(JSON.stringify({ pitrDrill: true, database, timestamp }))
}

function sentryConfiguration(
  slugVariable: string
): { readonly dsn: string; readonly slug: string } | undefined {
  const dsn = process.env.SENTRY_DSN
  const slug = process.env[slugVariable]
  if (dsn === undefined && slug === undefined) {
    return undefined
  }
  if (dsn === undefined || slug === undefined || slug.trim().length === 0) {
    throw new Error(`SENTRY_DSN and ${slugVariable} must be configured together`)
  }
  if (!isSecureDsn(dsn)) {
    throw new Error('SENTRY_DSN must be an HTTPS URL without a password')
  }
  return { dsn, slug }
}

function sentryEnvelopeUrl(dsn: string): string {
  const parsed = new URL(dsn)
  const projectId = parsed.pathname.split('/').findLast((segment) => segment.length > 0)
  if (parsed.username.length === 0 || projectId === undefined) {
    throw new Error('SENTRY_DSN is invalid')
  }
  const prefix = parsed.pathname.slice(0, -(projectId.length + 1))
  const endpoint = new URL(`${prefix}/api/${projectId}/envelope/`, parsed.origin)
  endpoint.searchParams.set('sentry_version', '7')
  endpoint.searchParams.set('sentry_key', parsed.username)
  endpoint.searchParams.set('sentry_client', 'b2b-saas-starter-backup/1')
  return endpoint.href
}

async function sendCheckIn(
  configuration: { readonly dsn: string; readonly slug: string },
  checkInId: string,
  status: 'in_progress' | 'ok' | 'error',
  duration?: number
): Promise<void> {
  const payload: SentryCheckInPayload = {
    check_in_id: checkInId,
    monitor_slug: configuration.slug,
    status,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production'
  }
  if (duration !== undefined) {
    payload.duration = duration
  }
  const envelope = [
    JSON.stringify({ sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'check_in' }),
    JSON.stringify(payload)
  ].join('\n')
  const response = await fetch(sentryEnvelopeUrl(configuration.dsn), {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`Sentry check-in failed (${response.status})`)
  }
}

export async function runWithSentryCronMonitor(
  slugVariable: string,
  operation: () => Promise<void>
): Promise<void> {
  const configuration = sentryConfiguration(slugVariable)
  if (configuration === undefined) {
    await operation()
    return
  }
  const checkInId = randomUUID().replaceAll('-', '')
  const started = Date.now()
  let monitoringFailure: unknown
  try {
    await sendCheckIn(configuration, checkInId, 'in_progress')
  } catch (error) {
    monitoringFailure = error
    console.error('failed to start Sentry check-in', error)
  }
  try {
    await operation()
  } catch (error) {
    try {
      await sendCheckIn(
        configuration,
        checkInId,
        'error',
        (Date.now() - started) / 1000
      )
    } catch (notificationError) {
      console.error('failed to report command failure to Sentry', notificationError)
    }
    throw error
  }
  try {
    await sendCheckIn(configuration, checkInId, 'ok', (Date.now() - started) / 1000)
  } catch (error) {
    if (monitoringFailure === undefined) {
      throw error
    }
    console.error('failed to finish Sentry check-in', error)
  }
  if (monitoringFailure !== undefined) {
    throw monitoringFailure
  }
}

async function main(args: ReadonlyArray<string>): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      drill: { type: 'boolean', default: false },
      database: { type: 'string' },
      timestamp: { type: 'string' },
      'confirm-target': { type: 'string' }
    }
  })
  const [command, input] = parsed.positionals
  if (command === 'backup') {
    await runWithSentryCronMonitor('SENTRY_BACKUP_MONITOR_SLUG', async () => {
      await backup(parsed.values.database)
    })
    return
  }
  if (command === 'prune') {
    console.log(`Deleted ${await prune(parsed.values.database)} expired backup(s)`)
    return
  }
  if (command === 'freshness') {
    await runWithSentryCronMonitor('SENTRY_BACKUP_FRESHNESS_MONITOR_SLUG', async () => {
      await freshness(parsed.values.database)
    })
    return
  }
  if (command === 'restore' && input !== undefined) {
    const options: RestoreOptions = { drill: parsed.values.drill }
    if (parsed.values['confirm-target'] !== undefined) {
      options.confirmTarget = parsed.values['confirm-target']
    }
    if (parsed.values.database !== undefined) {
      options.database = parsed.values.database
    }
    await restore(input, options)
    return
  }
  if (
    command === 'pitr-drill' &&
    parsed.values.database !== undefined &&
    parsed.values.timestamp !== undefined
  ) {
    await pitrDrill(
      parsed.values.database,
      parsed.values.timestamp,
      parsed.values['confirm-target']
    )
    return
  }
  throw new Error(
    'usage: d1-backup.ts backup|prune|freshness|restore <path-or-s3-url> [--drill]|pitr-drill --database=<isolated-name> --timestamp=<ISO-8601> --confirm-target=<account/name>'
  )
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
