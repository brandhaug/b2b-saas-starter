import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { runOperator } from './retention-operator.ts'

const NOW = new Date('2026-09-07T12:00:00.000Z')

describe('retention operator CLI', () => {
  let database: TestD1
  let directory: string

  // oxlint-disable-next-line effect/noTestLifecycleHooks -- one real workerd instance is shared because startup dominates this operator suite
  beforeAll(async () => {
    database = await provisionTestD1()
    directory = await mkdtemp(join(tmpdir(), 'retention-operator-test-'))
    await database.d1
      .prepare(
        "INSERT INTO workspaces (id, name, slug) VALUES ('retention-cli', 'Retention CLI', 'retention-cli')"
      )
      .run()
    await database.d1
      .prepare(
        `INSERT INTO notifications
          (id, workspace_id, title, message, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        'expired-notification',
        'retention-cli',
        'Private preview title',
        'Sensitive preview body',
        '2026-01-01T00:00:00.000Z'
      )
      .run()
  }, 30_000)

  // oxlint-disable-next-line effect/noTestLifecycleHooks -- closes the shared workerd instance and temporary artifacts
  afterAll(async () => {
    await database.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  function dependencies(output: Array<string>, at = NOW) {
    return {
      now: () => at,
      write: (text: string) => output.push(text),
      openDatabase: async () => ({ d1: database.d1, dispose: async () => undefined })
    }
  }

  it('runs the Live retention preview and writes a sanitized, target-bound artifact', async () => {
    const artifactPath = join(directory, 'preview.json')
    const output: Array<string> = []

    await runOperator(
      ['preview', '--local', '--output', artifactPath],
      {
        RETENTION_CLEANUP_ENABLED: 'true',
        RETENTION_RECOVERY_VERIFIED: 'true',
        RETENTION_EMAIL_DAYS: '31',
        RETENTION_POLICY_APPROVAL_DIGEST: 'stale',
        RETENTION_PREVIEW_DIGEST: 'stale',
        RETENTION_RECOVERY_EVIDENCE: 'earlier-drill'
      },
      dependencies(output)
    )

    const artifactText = await readFile(artifactPath, 'utf8')
    const artifact = JSON.parse(artifactText)
    const summary = JSON.parse(output.join(''))
    expect(artifact).toMatchObject({
      schema: 1,
      kind: 'retention-preview',
      createdAt: NOW.toISOString(),
      expiresAt: '2026-09-08T12:00:00.000Z',
      target: {
        kind: 'local',
        database: 'b2b-saas-starter',
        deployment: 'local',
        key: 'local:local:b2b-saas-starter'
      },
      result: {
        mode: 'preview',
        status: 'success',
        failed: 0,
        candidates: { notifications: 1 },
        deleted: { notifications: 0 }
      }
    })
    expect(artifact.policy).toMatchObject({
      emailDays: 31,
      destructiveEnabled: false,
      recoveryVerified: false
    })
    expect(summary.policyDigest).toBe(artifact.policyDigest)
    expect(artifact.policy.target).toBe(artifact.target.key)
    expect(artifactText).not.toMatch(
      /Private preview title|Sensitive preview body|expired-notification/
    )
    const stored = await database.d1
      .prepare("SELECT id FROM notifications WHERE id = 'expired-notification'")
      .all()
    expect(stored.results).toHaveLength(1)
  })

  it('requires exact policy and target confirmation before emitting deployable env', async () => {
    const artifactPath = join(directory, 'preview.json')
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
    const output: Array<string> = []

    await runOperator(
      [
        'approve',
        '--artifact',
        artifactPath,
        '--confirm',
        artifact.policyDigest,
        '--confirm-target',
        artifact.target.key,
        '--recovery-evidence',
        'restore-drill/prod-2026-09-07.json'
      ],
      {},
      dependencies(output, new Date('2026-09-07T13:00:00.000Z'))
    )

    const approval = JSON.parse(output.join(''))
    expect(approval).toMatchObject({
      kind: 'retention-policy-approval',
      target: artifact.target,
      environment: {
        RETENTION_POLICY_TARGET: artifact.target.key,
        RETENTION_CLEANUP_ENABLED: 'true',
        RETENTION_RECOVERY_VERIFIED: 'true',
        RETENTION_POLICY_APPROVAL_DIGEST: artifact.policyDigest,
        RETENTION_PREVIEW_DIGEST: artifact.policyDigest,
        RETENTION_RECOVERY_EVIDENCE: 'restore-drill/prod-2026-09-07.json'
      }
    })

    await expect(
      runOperator(
        [
          'approve',
          '--artifact',
          artifactPath,
          '--confirm',
          artifact.policyDigest,
          '--confirm-target',
          'remote:prod:another-database',
          '--recovery-evidence',
          'restore-drill/prod-2026-09-07.json'
        ],
        {},
        dependencies([])
      )
    ).rejects.toThrow('target confirmation')
  })

  it('rejects expired previews and malformed policy env before opening D1', async () => {
    const artifactPath = join(directory, 'expired-preview.json')
    const artifact = JSON.parse(await readFile(join(directory, 'preview.json'), 'utf8'))
    artifact.expiresAt = '2026-09-07T11:59:59.999Z'
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`)

    await expect(
      runOperator(
        [
          'approve',
          '--artifact',
          artifactPath,
          '--confirm',
          artifact.policyDigest,
          '--confirm-target',
          artifact.target.key,
          '--recovery-evidence',
          'restore-drill/prod-2026-09-07.json'
        ],
        {},
        dependencies([])
      )
    ).rejects.toThrow('expired')

    let opened = false
    await expect(
      runOperator(
        ['preview', '--local', '--output', join(directory, 'invalid.json')],
        { RETENTION_EMAIL_DAYS: 'thirty' },
        {
          now: () => NOW,
          openDatabase: async () => {
            opened = true
            return { d1: database.d1, dispose: async () => undefined }
          }
        }
      )
    ).rejects.toThrow('retention_emailDays_below_safety_window')
    expect(opened).toBe(false)
  })
})
