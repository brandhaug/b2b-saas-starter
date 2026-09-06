// oxlint-disable effect/noAsyncFunction -- the gzip round-trip is promise-based by construction; the suite drives bytes, not Effects
import { describe, expect, it } from 'vite-plus/test'

import {
  buildWorkspaceExportArchive,
  renderWorkspaceExportReadme,
  workspaceExportDocument,
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
          responseStatus: 200,
          payload: { tokenId: 'tok_1' },
          requestHeaders: null,
          responseBody: null,
          replayedFrom: null
        }
      ]
    }
  ],
  auditEvents: [
    {
      id: 'aud_1',
      actorType: 'user',
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

/** Gunzips the archive and parses the JSON document inside, as the reader would. */
async function readArchive(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  }).pipeThrough(new DecompressionStream('gzip'))
  const text = new TextDecoder().decode(await new Response(stream).arrayBuffer())
  // oxlint-disable-next-line effect/noGlobals -- the test decodes the actual wire bytes; a codec here would test the codec
  const parsed: Record<string, unknown> = JSON.parse(text)
  return parsed
}

describe('buildWorkspaceExportArchive', () => {
  it('is deterministic for a fixed snapshot', async () => {
    const first = await buildWorkspaceExportArchive(snapshot)
    const second = await buildWorkspaceExportArchive(snapshot)
    expect(second).toEqual(first)
    // Gzip magic bytes: 0x1f 0x8b.
    expect([...first.subarray(0, 2)]).toEqual([0x1f, 0x8b])
  })

  it('gunzips into the document the snapshot fills', async () => {
    const document = await readArchive(await buildWorkspaceExportArchive(snapshot))
    expect(document.schemaVersion).toBe(1)
    expect(document.exportId).toBe('exp_fixed')
    expect(document.generatedAt).toBe('2026-08-25T10:30:44.000Z')
    expect(document.workspace).toEqual(snapshot.workspace)
    expect(document.members).toEqual(snapshot.members)
    expect(document.invitations).toEqual(snapshot.invitations)
    expect(document.apiTokens).toEqual(snapshot.apiTokens)
    expect(document.webhookEndpoints).toEqual(snapshot.webhookEndpoints)
    expect(document.auditEvents).toEqual(snapshot.auditEvents)
    expect(document.notifications).toEqual(snapshot.notifications)
  })

  it('never writes a secret: token hashes and signing secrets are absent by construction', async () => {
    // oxlint-disable-next-line effect/noGlobals -- the assertion scans the raw serialized document; that is the point
    const text = JSON.stringify(workspaceExportDocument(snapshot))
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain('signingSecret')
    expect(text).toContain('bsk_live_abc')
  })

  it('describes every field in the embedded README', () => {
    const readme = renderWorkspaceExportReadme(snapshot)
    for (const field of [
      'workspace',
      'members',
      'invitations',
      'apiTokens',
      'webhookEndpoints',
      'auditEvents',
      'notifications'
    ]) {
      expect(readme).toContain(field)
    }
    expect(readme).toContain('Schema version: 1')
    expect(readme).toContain('gzip-compressed')
    expect(readme).toContain('GDPR')
  })
})

describe('workspaceExportFileName', () => {
  it('names the archive after the workspace and export', () => {
    expect(workspaceExportFileName('fixed-lab', 'exp_fixed')).toBe(
      'fixed-lab-export-exp_fixed.json.gz'
    )
  })
})
