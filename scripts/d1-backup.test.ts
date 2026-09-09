import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  decryptBackup,
  encryptBackup,
  type BackupEvidence,
  type CompletedBackup,
  retentionPlan,
  runWithSentryCronMonitor
} from './d1-backup.ts'

const run = promisify(execFile)
const SCRIPT = join(import.meta.dirname, 'd1-backup.ts')
const DESTROY_SCRIPT = join(import.meta.dirname, 'alchemy-destroy.ts')
const KEY = Buffer.alloc(32, 7)
const KEY_HEX = KEY.toString('hex')
const roots = new Array<string>()

// Temporary paths are process resources rather than Effect services in these CLI tests.
// oxlint-disable-next-line effect/noTestLifecycleHooks
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, source, { mode: 0o700 })
  await chmod(path, 0o700)
}

function evidence(
  objectKey: string,
  createdAt: string,
  overrides: Partial<BackupEvidence> = {}
): BackupEvidence {
  return {
    schema: 1,
    database: 'test-db',
    objectKey,
    createdAt,
    completedAt: createdAt,
    durationMs: 100,
    exportDurationMs: 50,
    exportBlockingBudgetMs: 60_000,
    exportWithinBudget: true,
    plaintextBytes: 10,
    encryptedBytes: 47,
    sha256: 'a'.repeat(64),
    retentionDays: 30,
    ...overrides
  }
}

function completed(objectKey: string, createdAt: string): CompletedBackup {
  return {
    evidence: evidence(objectKey, createdAt),
    completionKey: `${objectKey}.complete.enc`,
    lastModified: createdAt
  }
}

async function fakeAws(root: string): Promise<{
  readonly executable: string
  readonly log: string
  readonly list: string
  readonly store: string
}> {
  const executablePath = join(root, 'aws.mjs')
  const log = join(root, 'aws.log')
  const list = join(root, 'list.json')
  const store = join(root, 'store')
  await executable(
    executablePath,
    `#!/usr/bin/env node
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_AWS_LOG, JSON.stringify(args) + '\\n')
const keyAt = args.indexOf('--key')
if (args[0] === 's3api' && args[1] === 'list-objects-v2') {
  process.stdout.write(readFileSync(process.env.FAKE_AWS_LIST))
  process.exit(0)
}
if (args[0] === 's3' && args[1] === 'cp') {
  const key = args[2].replace(/^s3:\\/\\/[^/]+\\//, '')
  mkdirSync(dirname(args[3]), { recursive: true })
  copyFileSync(join(process.env.FAKE_AWS_STORE, key), args[3])
  process.exit(0)
}
if (args[0] === 's3api' && args[1] === 'delete-object') {
  rmSync(join(process.env.FAKE_AWS_STORE, args[keyAt + 1]))
  process.exit(0)
}
process.exit(2)
`
  )
  return { executable: executablePath, log, list, store }
}

function awsEnvironment(fixture: Awaited<ReturnType<typeof fakeAws>>) {
  return {
    ...process.env,
    BACKUP_DATABASE: 'test-db',
    BACKUP_S3_BUCKET: 'bucket',
    BACKUP_ENCRYPTION_KEY: KEY_HEX,
    D1_BACKUP_AWS_BIN: fixture.executable,
    D1_BACKUP_RETRY_DELAY_MS: '0',
    FAKE_AWS_LOG: fixture.log,
    FAKE_AWS_LIST: fixture.list,
    FAKE_AWS_STORE: fixture.store
  }
}

async function put(store: string, key: string, contents: Buffer): Promise<void> {
  const path = join(store, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

describe('D1 backup encryption and retention', () => {
  it('authenticates ciphertext and rejects mutation', () => {
    const source = Buffer.from('CREATE TABLE example (id INTEGER PRIMARY KEY);\n')
    const encrypted = encryptBackup(source, KEY)
    expect(encrypted).not.toEqual(source)
    expect(decryptBackup(encrypted, KEY)).toEqual(source)
    encrypted[encrypted.length - 1] = (encrypted.at(-1) ?? 0) ^ 1
    expect(() => decryptBackup(encrypted, KEY)).toThrow(/authenticate|decrypt/i)
  })

  it('retains one completed backup for each of the newest 30 days', () => {
    const backups = Array.from({ length: 31 }, (_, offset) => {
      const day = String(offset + 1).padStart(2, '0')
      return completed(
        `d1/test-db/202608${day}T020000Z.sql.enc`,
        `2026-08-${day}T02:00:00.000Z`
      )
    })
    backups.push(
      completed('d1/test-db/20260831T010000Z.sql.enc', '2026-08-31T01:00:00.000Z')
    )
    expect(retentionPlan(backups).map((backup) => backup.evidence.objectKey)).toEqual([
      'd1/test-db/20260801T020000Z.sql.enc',
      'd1/test-db/20260831T010000Z.sql.enc'
    ])
  })
})

describe('destructive command guards', () => {
  it('does not invoke the object store CLI with an insecure endpoint', async () => {
    const root = await temporaryDirectory('backup-endpoint-')
    const fixture = await fakeAws(root)
    await writeFile(fixture.list, JSON.stringify({ Contents: [] }))

    await expect(
      run(process.execPath, [SCRIPT, 'freshness'], {
        env: {
          ...awsEnvironment(fixture),
          BACKUP_S3_ENDPOINT: 'http://storage.example.test'
        }
      })
    ).rejects.toMatchObject({ code: 1 })
    await expect(readFile(fixture.log)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not invoke Alchemy without the exact account and stage', async () => {
    const root = await temporaryDirectory('destroy-guard-')
    const called = join(root, 'called')
    const fake = join(root, 'alchemy')
    await executable(fake, `#!/bin/sh\nprintf '%s' "$*" > "${called}"\n`)
    await expect(
      run(process.execPath, [DESTROY_SCRIPT, '--stage=prod'], {
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: 'account-1',
          ALCHEMY_DESTROY_BIN: fake
        }
      })
    ).rejects.toMatchObject({ code: 1 })
    await expect(readFile(called)).rejects.toMatchObject({ code: 'ENOENT' })

    const result = await run(
      process.execPath,
      [DESTROY_SCRIPT, '--stage=prod', '--confirm-target=account-1/prod'],
      {
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: 'account-1',
          ALCHEMY_DESTROY_BIN: fake
        }
      }
    )
    expect(result.stderr).toBe('')
    expect(await readFile(called, 'utf8')).toBe('destroy --yes --stage prod')
  })

  it('propagates a destructive child-process failure', async () => {
    const root = await temporaryDirectory('destroy-failure-')
    const fake = join(root, 'alchemy')
    await executable(fake, '#!/bin/sh\nexit 23\n')
    await expect(
      run(
        process.execPath,
        [DESTROY_SCRIPT, '--stage=pr-42', '--confirm-target=account-1/pr-42'],
        {
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: 'account-1',
            ALCHEMY_DESTROY_BIN: fake
          }
        }
      )
    ).rejects.toMatchObject({ code: 1 })
  })

  it('does not invoke Wrangler for an unconfirmed remote restore or production PITR', async () => {
    const root = await temporaryDirectory('restore-guard-')
    const called = join(root, 'called')
    const fake = join(root, 'wrangler')
    const encrypted = join(root, 'backup.sql.enc')
    await executable(
      fake,
      `#!/bin/sh
printf '%s\n' "$*" >> "${called}"
if [ "$1 $2" = "d1 list" ]; then
  printf '[{"name":"recovery-drill","uuid":"database-uuid"}]'
fi
`
    )
    await writeFile(
      encrypted,
      encryptBackup(Buffer.from('CREATE TABLE user (id TEXT);'), KEY)
    )
    const env = {
      ...process.env,
      BACKUP_ENCRYPTION_KEY: KEY_HEX,
      BACKUP_DATABASE: 'production-db',
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      D1_BACKUP_WRANGLER_BIN: fake
    }
    await expect(
      run(
        process.execPath,
        [SCRIPT, 'restore', encrypted, '--database=production-db'],
        { env }
      )
    ).rejects.toMatchObject({ code: 1 })
    await expect(
      run(
        process.execPath,
        [
          SCRIPT,
          'pitr-drill',
          '--database=production-db',
          '--timestamp=2026-09-07T12:00:00Z',
          '--confirm-target=account-1/production-db'
        ],
        { env }
      )
    ).rejects.toMatchObject({ code: 1 })
    await expect(readFile(called)).rejects.toMatchObject({ code: 'ENOENT' })

    await run(
      process.execPath,
      [
        SCRIPT,
        'pitr-drill',
        '--database=recovery-drill',
        '--timestamp=2026-09-07T12:00:00Z',
        '--confirm-target=account-1/recovery-drill'
      ],
      { env }
    )
    const invocations = await readFile(called, 'utf8')
    expect(invocations).toContain('d1 list --json')
    expect(invocations).toContain('d1 time-travel restore database-uuid')
    expect(invocations).toContain('--timestamp=2026-09-07T12:00:00Z --json')
    expect(invocations).not.toContain('--remote')
  })
})

describe('Sentry cron check-ins', () => {
  it.each([
    'http://public@example.test/42',
    'https://public:secret@example.test/42',
    'not a URL'
  ])(
    'rejects insecure Sentry configuration before running the operation',
    async (dsn) => {
      const previousDsn = process.env.SENTRY_DSN
      const previousSlug = process.env.TEST_MONITOR_SLUG
      const operation = vi.fn(async () => undefined)
      process.env.SENTRY_DSN = dsn
      process.env.TEST_MONITOR_SLUG = 'backup-test'
      try {
        await expect(
          runWithSentryCronMonitor('TEST_MONITOR_SLUG', operation)
        ).rejects.toThrow(/SENTRY_DSN must be an HTTPS URL without a password/)
      } finally {
        if (previousDsn === undefined) {
          delete process.env.SENTRY_DSN
        } else {
          process.env.SENTRY_DSN = previousDsn
        }
        if (previousSlug === undefined) {
          delete process.env.TEST_MONITOR_SLUG
        } else {
          process.env.TEST_MONITOR_SLUG = previousSlug
        }
      }
      expect(operation).not.toHaveBeenCalled()
    }
  )

  it('emits linked failure and recovery check-ins under the configured slug', async () => {
    const bodies = new Array<string>()
    const previousDsn = process.env.SENTRY_DSN
    const previousSlug = process.env.TEST_MONITOR_SLUG
    process.env.SENTRY_DSN = 'https://public@example.test/42'
    process.env.TEST_MONITOR_SLUG = 'backup-test'
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(await new Response(init?.body).text())
      return new Response(null, { status: 200 })
    })
    try {
      await expect(
        runWithSentryCronMonitor('TEST_MONITOR_SLUG', async () => {
          throw new Error('controlled backup failure')
        })
      ).rejects.toThrow('controlled backup failure')
      await runWithSentryCronMonitor('TEST_MONITOR_SLUG', async () => {})
    } finally {
      vi.unstubAllGlobals()
      if (previousDsn === undefined) {
        delete process.env.SENTRY_DSN
      } else {
        process.env.SENTRY_DSN = previousDsn
      }
      if (previousSlug === undefined) {
        delete process.env.TEST_MONITOR_SLUG
      } else {
        process.env.TEST_MONITOR_SLUG = previousSlug
      }
    }
    expect(bodies).toHaveLength(4)
    expect(bodies[0]).toContain('"monitor_slug":"backup-test"')
    expect(bodies[0]).toContain('"status":"in_progress"')
    expect(bodies[1]).toContain('"status":"error"')
    expect(bodies[2]).toContain('"status":"in_progress"')
    expect(bodies[3]).toContain('"status":"ok"')
  })

  it('runs the operation before surfacing a Sentry outage', async () => {
    const previousDsn = process.env.SENTRY_DSN
    const previousSlug = process.env.TEST_MONITOR_SLUG
    const signals = new Array<AbortSignal | null | undefined>()
    let ran = false
    process.env.SENTRY_DSN = 'https://public@example.test/42'
    process.env.TEST_MONITOR_SLUG = 'backup-test'
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal)
      return new Response(null, { status: 503 })
    })
    try {
      await expect(
        runWithSentryCronMonitor('TEST_MONITOR_SLUG', async () => {
          ran = true
        })
      ).rejects.toThrow('Sentry check-in failed (503)')
    } finally {
      vi.unstubAllGlobals()
      if (previousDsn === undefined) {
        delete process.env.SENTRY_DSN
      } else {
        process.env.SENTRY_DSN = previousDsn
      }
      if (previousSlug === undefined) {
        delete process.env.TEST_MONITOR_SLUG
      } else {
        process.env.TEST_MONITOR_SLUG = previousSlug
      }
    }
    expect(ran).toBe(true)
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal !== undefined)).toBe(true)
  })
})

describe('freshness and prune subprocesses', () => {
  async function freshnessFixture(createdAt: string) {
    const root = await temporaryDirectory('backup-store-')
    const fixture = await fakeAws(root)
    const sql = Buffer.from('CREATE TABLE example (id INTEGER);')
    const stamp = createdAt
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z')
    const objectKey = `d1/test-db/${stamp}.sql.enc`
    const completionKey = `${objectKey}.complete.enc`
    const encrypted = encryptBackup(sql, KEY)
    const completion = encryptBackup(
      Buffer.from(
        JSON.stringify(
          evidence(objectKey, createdAt, {
            completedAt: createdAt,
            plaintextBytes: sql.length,
            encryptedBytes: encrypted.length,
            sha256: createHash('sha256').update(sql).digest('hex')
          })
        )
      ),
      KEY
    )
    await put(fixture.store, objectKey, encrypted)
    await put(fixture.store, completionKey, completion)
    await writeFile(
      fixture.list,
      JSON.stringify({
        Contents: [
          { Key: objectKey, LastModified: createdAt },
          { Key: completionKey, LastModified: createdAt }
        ]
      })
    )
    return { fixture, sql }
  }

  it('accepts a fresh authenticated backup and rejects a stale one', async () => {
    const fresh = await freshnessFixture(new Date().toISOString())
    const result = await run(process.execPath, [SCRIPT, 'freshness'], {
      env: awsEnvironment(fresh.fixture)
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      database: 'test-db',
      verifiedBytes: fresh.sql.length
    })

    const stale = await freshnessFixture('2026-01-01T00:00:00.000Z')
    await expect(
      run(process.execPath, [SCRIPT, 'freshness'], {
        env: awsEnvironment(stale.fixture)
      })
    ).rejects.toMatchObject({ code: 1 })
  }, 30_000)

  it('deletes both objects for the oldest completed day', async () => {
    const root = await temporaryDirectory('prune-store-')
    const fixture = await fakeAws(root)
    const objects = new Array<{ Key: string; LastModified: string }>()
    for (let offset = 1; offset <= 31; offset += 1) {
      const day = String(offset).padStart(2, '0')
      const createdAt = `2026-08-${day}T02:00:00.000Z`
      const objectKey = `d1/test-db/202608${day}T020000Z.sql.enc`
      const completionKey = `${objectKey}.complete.enc`
      const backup = completed(objectKey, createdAt)
      await put(fixture.store, objectKey, Buffer.from('ciphertext'))
      await put(
        fixture.store,
        completionKey,
        encryptBackup(Buffer.from(JSON.stringify(backup.evidence)), KEY)
      )
      objects.push(
        { Key: objectKey, LastModified: createdAt },
        { Key: completionKey, LastModified: createdAt }
      )
    }
    await writeFile(fixture.list, JSON.stringify({ Contents: objects }))
    const result = await run(process.execPath, [SCRIPT, 'prune'], {
      env: awsEnvironment(fixture)
    })
    expect(result.stdout).toContain('Deleted 1 expired backup(s)')
    const log = await readFile(fixture.log, 'utf8')
    const calls = log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      calls.filter((args) => args[0] === 's3api' && args[1] === 'delete-object')
    ).toHaveLength(2)
  }, 30_000)
})

describe('isolated restore integration', () => {
  it('restores synthetic SQL and verifies its application rows with Wrangler', async () => {
    const root = await temporaryDirectory('restore-drill-')
    const encrypted = join(root, 'synthetic.sql.enc')
    const sql = [
      'CREATE TABLE user (id TEXT PRIMARY KEY);',
      'CREATE TABLE organization (id TEXT PRIMARY KEY);',
      'CREATE TABLE member (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id), organizationId TEXT NOT NULL REFERENCES organization(id));',
      'CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id));',
      "INSERT INTO user VALUES ('usr_drill');",
      "INSERT INTO organization VALUES ('org_drill');",
      "INSERT INTO member VALUES ('mem_drill', 'usr_drill', 'org_drill');",
      "INSERT INTO session VALUES ('ses_drill', 'usr_drill');"
    ].join('\n')
    await writeFile(encrypted, encryptBackup(Buffer.from(sql), KEY))
    const result = await run(
      process.execPath,
      [SCRIPT, 'restore', encrypted, '--drill', '--database=recovery-drill'],
      {
        env: {
          ...process.env,
          BACKUP_ENCRYPTION_KEY: KEY_HEX,
          WRANGLER_LOG_PATH: join(root, 'wrangler.log')
        }
      }
    )
    expect(JSON.parse(result.stdout)).toMatchObject({
      drill: true,
      integrity: 'application_checks_passed',
      userCount: 1,
      workspaceCount: 1,
      membershipCount: 1,
      sessionCount: 1,
      orphanMembershipCount: 0,
      orphanSessionCount: 0,
      isolatedStoreRemoved: true
    })
  }, 30_000)
})
