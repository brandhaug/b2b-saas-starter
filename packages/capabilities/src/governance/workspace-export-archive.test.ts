import { Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import {
  buildWorkspaceExportArchive,
  buildZipArchive,
  crc32,
  renderWorkspaceExportReadme,
  workspaceExportEntries,
  workspaceExportFileName,
  type WorkspaceExportSnapshot
} from './workspace-export-archive.ts'

/**
 * A fixed snapshot: every timestamp is a literal, so the archive bytes are a
 * function of this object alone and the determinism assertion below is exact.
 */
const snapshot: WorkspaceExportSnapshot = {
  exportId: 'exp_fixed',
  generatedAt: '2026-08-25T10:30:44.000Z',
  workspace: { id: 'wrk_fixed', slug: 'fixed-lab', name: 'Fixed Lab', planId: 'team' },
  members: [
    {
      id: 'usr_a',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'owner',
      systemRole: 'user'
    }
  ],
  invitations: [
    {
      id: 'inv_1',
      email: 'bob@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-08-27T10:30:44.000Z'
    }
  ],
  apiTokens: [
    {
      id: 'tok_1',
      name: 'CI',
      prefix: 'bsk_live_abc',
      scopes: ['read'],
      lastUsedAt: null,
      createdAt: '2026-08-20T00:00:00.000Z'
    }
  ],
  webhookEndpoints: [
    {
      id: 'wh_1',
      url: 'https://example.com/hook',
      enabled: true,
      events: ['api_token.created'],
      successRate: 100,
      deliveries: [
        {
          id: 'whd_1',
          endpointId: 'wh_1',
          eventType: 'api_token.created',
          status: 'delivered',
          attempts: 1,
          lastAttemptAt: '2026-08-21T00:00:00.000Z',
          nextAttemptAt: null,
          responseStatus: 200
        }
      ]
    }
  ],
  auditEvents: [
    {
      id: 'aud_1',
      eventType: 'api_token.created',
      targetType: 'api_token',
      targetId: 'tok_1',
      actor: 'Ada',
      createdAt: '2026-08-20T00:00:00.000Z'
    }
  ],
  notifications: [
    {
      id: 'not_1',
      kind: 'announcement',
      title: 'Hello',
      message: 'World',
      createdAt: '2026-08-19T00:00:00.000Z',
      read: false
    }
  ]
}

const decoder = new TextDecoder()

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

type ParsedEntry = {
  readonly name: string
  readonly content: string
  readonly crc: number
  readonly time: number
  readonly date: number
}

/**
 * A minimal STORE-only reader over the central directory, so the tests assert
 * the archive against the format rather than against the writer's own
 * bookkeeping.
 */
function readZip(bytes: Uint8Array) {
  const eocd = bytes.length - 22
  expect(u32(bytes, eocd)).toBe(0x06_05_4b_50)
  const entryCount = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  expect(centralOffset + centralSize).toBe(eocd)

  const entries: Array<ParsedEntry> = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    expect(u32(bytes, cursor)).toBe(0x02_01_4b_50)
    const time = u16(bytes, cursor + 12)
    const date = u16(bytes, cursor + 14)
    const crc = u32(bytes, cursor + 16)
    const size = u32(bytes, cursor + 24)
    const nameLength = u16(bytes, cursor + 28)
    const localOffset = u32(bytes, cursor + 42)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    // Local header: signature, then the same name, then the stored bytes.
    expect(u32(bytes, localOffset)).toBe(0x04_03_4b_50)
    const localNameLength = u16(bytes, localOffset + 26)
    const localExtraLength = u16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const content = decoder.decode(bytes.subarray(dataStart, dataStart + size))
    entries.push({ name, content, crc, time, date })
    cursor += 46 + nameLength
  }
  return { entries, entryCount } satisfies {
    readonly entries: ReadonlyArray<ParsedEntry>
    readonly entryCount: number
  }
}

// The entries are JSON text; decode them through a codec, as the app would.
const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcb_f4_39_26)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('buildWorkspaceExportArchive', () => {
  it('is deterministic for a fixed snapshot', () => {
    const first = buildWorkspaceExportArchive(snapshot)
    const second = buildWorkspaceExportArchive(snapshot)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(22)
  })

  it('writes one STORE entry per file, in order, with valid CRCs', () => {
    const bytes = buildWorkspaceExportArchive(snapshot)
    const { entries, entryCount } = readZip(bytes)
    const expected = workspaceExportEntries(snapshot)
    expect(entryCount).toBe(expected.length)
    expect(entries.map((entry) => entry.name)).toEqual(
      expected.map((entry) => entry.path)
    )
    for (const [index, entry] of entries.entries()) {
      expect(entry.content).toBe(expected[index]?.content)
      expect(entry.crc).toBe(crc32(new TextEncoder().encode(entry.content)))
    }
  })

  it('stamps every entry with the snapshot time as a DOS date and time in UTC', () => {
    const { entries } = readZip(buildWorkspaceExportArchive(snapshot))
    // 2026-08-25 → (2026-1980)<<9 | 8<<5 | 25 ; 10:30:44 → 10<<11 | 30<<5 | 22
    const expectedDate = (46 << 9) | (8 << 5) | 25
    const expectedTime = (10 << 11) | (30 << 5) | 22
    for (const entry of entries) {
      expect(entry.date).toBe(expectedDate)
      expect(entry.time).toBe(expectedTime)
    }
  })

  it('lists the seven data files behind the README', () => {
    expect(workspaceExportEntries(snapshot).map((entry) => entry.path)).toEqual([
      'README.txt',
      'workspace.json',
      'members.json',
      'invitations.json',
      'api-tokens.json',
      'webhook-endpoints.json',
      'audit-events.json',
      'notifications.json'
    ])
  })

  it('carries the workspace record, counts, and schema version in workspace.json', () => {
    const entry = workspaceExportEntries(snapshot).find(
      (candidate) => candidate.path === 'workspace.json'
    )
    expect(parseJson(entry?.content ?? '')).toEqual({
      schemaVersion: 1,
      exportId: 'exp_fixed',
      generatedAt: '2026-08-25T10:30:44.000Z',
      workspace: snapshot.workspace,
      counts: {
        members: 1,
        invitations: 1,
        apiTokens: 1,
        webhookEndpoints: 1,
        auditEvents: 1,
        notifications: 1
      }
    })
  })

  it('never writes a secret: token hashes and signing secrets are absent by construction', () => {
    const text = workspaceExportEntries(snapshot)
      .map((entry) => entry.content)
      .join('\n')
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain('signingSecret')
    expect(text).toContain('bsk_live_abc')
  })

  it('describes every file in the README', () => {
    const readme = renderWorkspaceExportReadme(snapshot)
    for (const entry of workspaceExportEntries(snapshot).slice(1)) {
      expect(readme).toContain(entry.path)
    }
    expect(readme).toContain('Schema version: 1')
    expect(readme).toContain('GDPR')
  })
})

describe('buildZipArchive', () => {
  it('handles an empty archive', () => {
    const bytes = buildZipArchive([], '2026-01-01T00:00:00.000Z')
    expect(bytes).toHaveLength(22)
    expect(readZip(bytes).entryCount).toBe(0)
  })

  it('encodes UTF-8 entry names and content', () => {
    const { entries } = readZip(
      buildZipArchive(
        [{ path: 'ünïcode.txt', content: 'héllo' }],
        '2026-01-01T00:00:00.000Z'
      )
    )
    expect(entries[0]).toMatchObject({ name: 'ünïcode.txt', content: 'héllo' })
  })
})

describe('workspaceExportFileName', () => {
  it('names the archive after the workspace and export', () => {
    expect(workspaceExportFileName('fixed-lab', 'exp_fixed')).toBe(
      'fixed-lab-export-exp_fixed.zip'
    )
  })
})
