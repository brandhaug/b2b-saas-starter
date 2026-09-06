import { type ApiToken } from '../developer-platform/api-token-registry.ts'
import { type WebhookDelivery } from '../developer-platform/webhook-delivery-plan.ts'
import { type WebhookEndpoint } from '../developer-platform/webhook-endpoints.ts'
import { type Notification } from '../notifications/notification-feed.ts'
import { type AuditEvent } from './audit-event-log.ts'
import { type Member, type Workspace } from './workspace-identity.ts'
import { type Invitation } from './workspace-invitations.ts'

// oxlint-disable effect/noAsyncFunction -- platform adapter: the gzip pipeline is the web-standard CompressionStream (promise-based; no Effect service exists), and both call sites fold it in through Effect.tryPromise

/**
 * The workspace export archive (ADR 0055): what goes into the artifact and how
 * the bytes are laid out. Pure input, standard-library output —
 * `collectWorkspaceExportSnapshot` (`workspace-export-snapshot.ts`) fills the
 * snapshot from the capability services; this module turns one into a single
 * pretty-printed JSON document and gzips it through the web-standard
 * `CompressionStream`. No dependency, no hand-rolled container format, and
 * deterministic output for a fixed snapshot within one runtime.
 */

/** Bumped when the document's shape changes; written into the document and the README. */
const WORKSPACE_EXPORT_SCHEMA_VERSION = 1

type WorkspaceExportWebhookEndpoint = WebhookEndpoint & {
  readonly deliveries: ReadonlyArray<WebhookDelivery>
}

/** Everything one export carries, already projected to the wire DTOs — never a raw row. */
export type WorkspaceExportSnapshot = {
  readonly exportId: string
  /** ISO instant the snapshot was taken. */
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

/**
 * The one JSON document an export is: the record (identity, version), the
 * offline self-description, and every DTO list. Field-level row counts are
 * gone on purpose — in a single document they are `doc.members.length`, not
 * a header a reader has to trust.
 */
type WorkspaceExportDocument = {
  readonly schemaVersion: number
  readonly exportId: string
  readonly generatedAt: string
  /** The rendered README — see {@link renderWorkspaceExportReadme}. */
  readonly readme: string
  readonly workspace: Workspace
  readonly members: ReadonlyArray<Member>
  readonly invitations: ReadonlyArray<Invitation>
  readonly apiTokens: ReadonlyArray<ApiToken>
  readonly webhookEndpoints: ReadonlyArray<WorkspaceExportWebhookEndpoint>
  readonly auditEvents: ReadonlyArray<AuditEvent>
  readonly notifications: ReadonlyArray<Notification>
}

/** The README embedded in every export. Describes each field so the document explains itself offline. */
export function renderWorkspaceExportReadme(snapshot: WorkspaceExportSnapshot): string {
  return [
    `Workspace export — ${snapshot.workspace.name} (${snapshot.workspace.slug})`,
    `Export id: ${snapshot.exportId}`,
    `Generated at: ${snapshot.generatedAt}`,
    `Schema version: ${WORKSPACE_EXPORT_SCHEMA_VERSION}`,
    '',
    'This document is UTF-8 JSON, stored and served gzip-compressed.',
    'Timestamps are ISO 8601 in UTC. Identifiers are the same opaque ids',
    'the application uses, so lists cross-reference by id.',
    '',
    'workspace',
    '  { id, slug, name, planId }',
    '  The exported workspace record.',
    '',
    'members',
    '  [{ id, name, email, role, systemRole }]',
    '  Current members. `role` is the workspace role (owner | admin | member);',
    '  `systemRole` is the account-level Better Auth role (admin | user).',
    '',
    'invitations',
    '  [{ id, email, role, status, expiresAt }]',
    '  Every invitation, settled or pending. `status` is pending | accepted |',
    '  rejected | canceled.',
    '',
    'apiTokens',
    '  [{ id, name, prefix, scopes, lastUsedAt, createdAt }]',
    '  Active API token metadata only. The secret is shown once at creation and',
    '  is never stored or exported; `prefix` is the first characters for',
    '  recognition. `scopes` is a subset of read | write | admin.',
    '',
    'webhookEndpoints',
    '  [{ id, url, enabled, events, successRate, deliveries: [...] }]',
    '  Registered endpoints without their signing secret. Each `deliveries`',
    '  entry is { id, endpointId, eventType, status, attempts, lastAttemptAt,',
    '  nextAttemptAt, responseStatus }.',
    '',
    'auditEvents',
    '  [{ id, eventType, targetType, targetId, actor, createdAt }]',
    '  The complete workspace audit trail, newest first. `actor` is the display',
    '  name of the acting user, or "system".',
    '',
    'notifications',
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

/** The snapshot as the single self-describing document. */
export function workspaceExportDocument(
  snapshot: WorkspaceExportSnapshot
): WorkspaceExportDocument {
  return {
    schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
    exportId: snapshot.exportId,
    generatedAt: snapshot.generatedAt,
    readme: renderWorkspaceExportReadme(snapshot),
    workspace: snapshot.workspace,
    members: snapshot.members,
    invitations: snapshot.invitations,
    apiTokens: snapshot.apiTokens,
    webhookEndpoints: snapshot.webhookEndpoints,
    auditEvents: snapshot.auditEvents,
    notifications: snapshot.notifications
  }
}

/**
 * Pretty JSON, two-space indented. The one `JSON.stringify` of this package
 * outside a Schema codec: the DTOs it serialises are the capabilities' own
 * wire structs, already JSON-shaped, and a human opens this document — a
 * codec's compact output is the wrong trade.
 */
function prettyJson(value: WorkspaceExportDocument): string {
  // oxlint-disable-next-line effect/noGlobals -- see the note on the function
  return `${JSON.stringify(value, null, 2)}\n`
}

// The one text encoder of the module — the platform's, since Workers have no
// other, and a UTF-8 encode has nothing for Effect to manage.
const utf8 = new TextEncoder()

/**
 * Gzip through the web-standard `CompressionStream` — available in Workers
 * and Node alike, and deterministic within one runtime for a fixed input
 * (the header's mtime is zero). Cross-runtime byte identity is NOT claimed:
 * the deflate implementation and the header's OS byte differ between Node
 * (local dev, tests) and workerd (production), and nothing here compares
 * bytes across runtimes.
 */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  }).pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The whole recipe: snapshot → document → gzipped JSON bytes. */
export async function buildWorkspaceExportArchive(
  snapshot: WorkspaceExportSnapshot
): Promise<Uint8Array> {
  return gzip(utf8.encode(prettyJson(workspaceExportDocument(snapshot))))
}

/** `<slug>-export-<exportId>.json.gz` — the `Content-Disposition` file name. */
export function workspaceExportFileName(
  workspaceSlug: string,
  exportId: string
): string {
  return `${workspaceSlug}-export-${exportId}.json.gz`
}
