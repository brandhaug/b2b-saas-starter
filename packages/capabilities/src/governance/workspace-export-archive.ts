import { DateTime } from 'effect'

import { type ApiToken } from '../developer-platform/api-token-registry.ts'
import { type WebhookDelivery } from '../developer-platform/webhook-delivery-plan.ts'
import { type WebhookEndpoint } from '../developer-platform/webhook-endpoints.ts'
import { type Notification } from '../notifications/notification-feed.ts'
import { type AuditEvent } from './audit-event-log.ts'
import { type Member, type Workspace } from './workspace-identity.ts'
import { type Invitation } from './workspace-invitations.ts'

/**
 * The workspace export archive (ADR 0055): what goes into the ZIP and how the
 * bytes are laid out. Pure — no I/O, no clock, no randomness — so the same
 * snapshot always produces the same bytes. `collectWorkspaceSnapshot`
 * (`workspace-export-snapshot.ts`) fills the snapshot from the capability
 * services; this module only turns one into an archive.
 *
 * The ZIP is written by hand in STORE mode (no compression). A dependency
 * would buy smaller files at the cost of a second source of non-determinism
 * and a Workers-compatibility question; the archives are JSON of starter-scale
 * workspaces, and a determinstic byte layout is what the tests assert on.
 */

/** Bumped when a file's shape changes; written into `workspace.json` and the README. */
export const WORKSPACE_EXPORT_SCHEMA_VERSION = 1

export type WorkspaceExportWebhookEndpoint = WebhookEndpoint & {
  readonly deliveries: ReadonlyArray<WebhookDelivery>
}

/** Everything one export carries, already projected to the wire DTOs — never a raw row. */
export type WorkspaceExportSnapshot = {
  readonly exportId: string
  /** ISO instant the snapshot was taken; also the ZIP entries' modification time. */
  readonly generatedAt: string
  readonly workspace: Workspace
  readonly members: ReadonlyArray<Member>
  readonly invitations: ReadonlyArray<Invitation>
  /** Token metadata only: the registry's DTO never carries the secret or its hash. */
  readonly apiTokens: ReadonlyArray<ApiToken>
  /** Endpoint projections (no signing secret) with their recorded deliveries. */
  readonly webhookEndpoints: ReadonlyArray<WorkspaceExportWebhookEndpoint>
  readonly auditEvents: ReadonlyArray<AuditEvent>
  /** Workspace broadcasts only — user-targeted notifications belong to the user, not the workspace. */
  readonly notifications: ReadonlyArray<Notification>
}

export type WorkspaceExportEntry = {
  readonly path: string
  readonly content: string
}

/** `workspace.json`: the record, the export's identity, and each other file's row count. */
export type WorkspaceExportManifest = {
  readonly schemaVersion: number
  readonly exportId: string
  readonly generatedAt: string
  readonly workspace: Workspace
  readonly counts: Readonly<Record<string, number>>
}

/** What one archive entry serialises: the manifest, or one of the DTO lists. */
type WorkspaceExportFile =
  | WorkspaceExportManifest
  | ReadonlyArray<Member>
  | ReadonlyArray<Invitation>
  | ReadonlyArray<ApiToken>
  | ReadonlyArray<WorkspaceExportWebhookEndpoint>
  | ReadonlyArray<AuditEvent>
  | ReadonlyArray<Notification>

/** The README every archive opens with. Describes each file's fields so the ZIP explains itself offline. */
export function renderWorkspaceExportReadme(snapshot: WorkspaceExportSnapshot): string {
  return [
    `Workspace export — ${snapshot.workspace.name} (${snapshot.workspace.slug})`,
    `Export id: ${snapshot.exportId}`,
    `Generated at: ${snapshot.generatedAt}`,
    `Schema version: ${WORKSPACE_EXPORT_SCHEMA_VERSION}`,
    '',
    'Every file is UTF-8 JSON. Timestamps are ISO 8601 in UTC. Identifiers are',
    'the same opaque ids the application uses, so files cross-reference by id.',
    '',
    'workspace.json',
    '  { schemaVersion, exportId, generatedAt, workspace: { id, slug, name, planId }, counts }',
    '  The workspace record and how many rows each other file holds.',
    '',
    'members.json',
    '  [{ id, name, email, role, systemRole }]',
    '  Current members. `role` is the workspace role (owner | admin | member);',
    '  `systemRole` is the account-level Better Auth role (admin | user).',
    '',
    'invitations.json',
    '  [{ id, email, role, status, expiresAt }]',
    '  Every invitation, settled or pending. `status` is pending | accepted |',
    '  rejected | canceled.',
    '',
    'api-tokens.json',
    '  [{ id, name, prefix, scopes, lastUsedAt, createdAt }]',
    '  Active API token metadata only. The secret is shown once at creation and',
    '  is never stored or exported; `prefix` is the first characters for',
    '  recognition. `scopes` is a subset of read | write | admin.',
    '',
    'webhook-endpoints.json',
    '  [{ id, url, enabled, events, successRate, deliveries: [...] }]',
    '  Registered endpoints without their signing secret. Each `deliveries`',
    '  entry is { id, endpointId, eventType, status, attempts, lastAttemptAt,',
    '  nextAttemptAt, responseStatus }.',
    '',
    'audit-events.json',
    '  [{ id, eventType, targetType, targetId, actor, createdAt }]',
    '  The complete workspace audit trail, newest first. `actor` is the display',
    '  name of the acting user, or "system".',
    '',
    'notifications.json',
    '  [{ id, title, message, createdAt, read }]',
    '  Workspace-wide notifications. Notifications addressed to one user are',
    '  personal data of that user and are not part of a workspace export.',
    '',
    'Data subject requests: this archive plus the account deletion flow is how a',
    'GDPR access or erasure request is served. See the governance documentation',
    '(docs/governance/data-export) in the deployed application.',
    ''
  ].join('\n')
}

/**
 * Pretty JSON, two-space indented, for the archive entries. The one
 * `JSON.stringify` of this package outside a Schema codec: the DTOs it
 * serialises are the capabilities' own wire structs, already JSON-shaped, and
 * a human opens these files — a codec's compact output is the wrong trade.
 */
function prettyJson(value: WorkspaceExportFile): string {
  // oxlint-disable-next-line effect/noGlobals -- see the note on the function
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The archive's files, in the order they are written. */
export function workspaceExportEntries(
  snapshot: WorkspaceExportSnapshot
): ReadonlyArray<WorkspaceExportEntry> {
  return [
    { path: 'README.txt', content: renderWorkspaceExportReadme(snapshot) },
    {
      path: 'workspace.json',
      content: prettyJson({
        schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
        exportId: snapshot.exportId,
        generatedAt: snapshot.generatedAt,
        workspace: snapshot.workspace,
        counts: {
          members: snapshot.members.length,
          invitations: snapshot.invitations.length,
          apiTokens: snapshot.apiTokens.length,
          webhookEndpoints: snapshot.webhookEndpoints.length,
          auditEvents: snapshot.auditEvents.length,
          notifications: snapshot.notifications.length
        }
      })
    },
    { path: 'members.json', content: prettyJson(snapshot.members) },
    { path: 'invitations.json', content: prettyJson(snapshot.invitations) },
    { path: 'api-tokens.json', content: prettyJson(snapshot.apiTokens) },
    { path: 'webhook-endpoints.json', content: prettyJson(snapshot.webhookEndpoints) },
    { path: 'audit-events.json', content: prettyJson(snapshot.auditEvents) },
    { path: 'notifications.json', content: prettyJson(snapshot.notifications) }
  ]
}

// --- ZIP writer -----------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      if ((c & 1) === 1) {
        c = 0xed_b8_83_20 ^ (c >>> 1)
      } else {
        c >>>= 1
      }
    }
    table[n] = c >>> 0
  }
  return table
})()

/** IEEE CRC-32, as the ZIP format requires. Exported for the archive tests. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0
}

/**
 * MS-DOS date and time fields from an ISO instant, in UTC. ZIP has no time
 * zone, so UTC is the only choice that makes the same snapshot the same bytes
 * wherever it is built. The format cannot express years before 1980.
 */
function dosDateTime(iso: string) {
  const parts = DateTime.toParts(DateTime.makeUnsafe(iso))
  const year = Math.max(parts.year, 1980)
  const date = ((year - 1980) << 9) | (parts.month << 5) | parts.day
  const time = (parts.hour << 11) | (parts.minute << 5) | Math.floor(parts.second / 2)
  return { date, time } satisfies { readonly date: number; readonly time: number }
}

const LOCAL_HEADER_SIGNATURE = 0x04_03_4b_50
const CENTRAL_HEADER_SIGNATURE = 0x02_01_4b_50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06_05_4b_50
/** Bit 11: file names are UTF-8. */
const UTF8_NAMES_FLAG = 0x08_00
const ZIP_VERSION = 20
const METHOD_STORE = 0

type StoredEntry = {
  readonly name: Uint8Array
  readonly data: Uint8Array
  readonly crc: number
  readonly offset: number
}

/** A little-endian byte writer over a growable buffer. */
class ByteWriter {
  private chunks: Array<Uint8Array> = []
  private total = 0

  get length(): number {
    return this.total
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(value)
    this.total += value.length
  }

  u16(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]))
  }

  u32(value: number): void {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff
      ])
    )
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.total)
    let position = 0
    for (const chunk of this.chunks) {
      out.set(chunk, position)
      position += chunk.length
    }
    return out
  }
}

// The one text encoder of the module — the platform's, since Workers have no
// other, and a UTF-8 encode has nothing for Effect to manage.
const utf8 = new TextEncoder()

/**
 * Builds a STORE-mode ZIP from text entries. Deterministic: entry order is
 * the caller's, every timestamp is `modifiedAt`, and nothing is compressed.
 */
export function buildZipArchive(
  entries: ReadonlyArray<WorkspaceExportEntry>,
  modifiedAt: string
): Uint8Array {
  const { date, time } = dosDateTime(modifiedAt)
  const writer = new ByteWriter()
  const stored: Array<StoredEntry> = []

  for (const entry of entries) {
    const name = utf8.encode(entry.path)
    const data = utf8.encode(entry.content)
    const crc = crc32(data)
    const offset = writer.length
    writer.u32(LOCAL_HEADER_SIGNATURE)
    writer.u16(ZIP_VERSION)
    writer.u16(UTF8_NAMES_FLAG)
    writer.u16(METHOD_STORE)
    writer.u16(time)
    writer.u16(date)
    writer.u32(crc)
    writer.u32(data.length)
    writer.u32(data.length)
    writer.u16(name.length)
    writer.u16(0)
    writer.bytes(name)
    writer.bytes(data)
    stored.push({ name, data, crc, offset })
  }

  const centralDirectoryOffset = writer.length
  for (const entry of stored) {
    writer.u32(CENTRAL_HEADER_SIGNATURE)
    writer.u16(ZIP_VERSION)
    writer.u16(ZIP_VERSION)
    writer.u16(UTF8_NAMES_FLAG)
    writer.u16(METHOD_STORE)
    writer.u16(time)
    writer.u16(date)
    writer.u32(entry.crc)
    writer.u32(entry.data.length)
    writer.u32(entry.data.length)
    writer.u16(entry.name.length)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u32(0)
    writer.u32(entry.offset)
    writer.bytes(entry.name)
  }
  const centralDirectorySize = writer.length - centralDirectoryOffset

  writer.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE)
  writer.u16(0)
  writer.u16(0)
  writer.u16(stored.length)
  writer.u16(stored.length)
  writer.u32(centralDirectorySize)
  writer.u32(centralDirectoryOffset)
  writer.u16(0)

  return writer.finish()
}

/** The whole recipe: snapshot → entries → ZIP, timestamped at `generatedAt`. */
export function buildWorkspaceExportArchive(
  snapshot: WorkspaceExportSnapshot
): Uint8Array {
  return buildZipArchive(workspaceExportEntries(snapshot), snapshot.generatedAt)
}

/** `<slug>-export-<exportId>.zip` — the `Content-Disposition` file name. */
export function workspaceExportFileName(
  workspaceSlug: string,
  exportId: string
): string {
  return `${workspaceSlug}-export-${exportId}.zip`
}
