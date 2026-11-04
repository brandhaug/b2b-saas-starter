import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  workspaceRoles,
  invitationStatuses,
  ssoProvisionedRoles,
  workspaceSuspensionStatuses
} from '../enums.ts'
import { user } from './auth.ts'
import { id, authCreatedAt, authTimestamps, workspaceIdIndex } from './columns.ts'

/**
 * The three workspace tables are owned by the organization plugin, so their
 * columns follow Better Auth's camelCase field names (`workspaceId`) rather
 * than the starter's snake_case. Everything else still points at
 * `workspace_id` — hence the parameter.
 */
export function workspaceRef(column = 'workspace_id') {
  return text(column)
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })
}

export function workspaceRefNullable() {
  return text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' })
}

// The three tables below are owned by Better Auth's `organization` plugin.
// The plugin's `organization`, `member`, and `invitation` models are remapped
// onto the starter's `workspace` vocabulary with `modelName` (see
// `packages/auth`), so the domain word never changes but the *shape* is the
// plugin's: its field names, its epoch-integer dates, its surrogate `id` keys.
// Add a column here only by adding an `additionalFields` entry on the plugin
// too — a column the plugin does not know about is invisible to its endpoints.

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').unique().notNull(),
    logo: text('logo'),
    // Plugin-owned free-form bag. The plugin JSON-stringifies on write and parses
    // on read itself, so this stays plain `text` — `mode: 'json'` would encode a
    // second time. The starter's own fields are `additionalFields` below, not
    // entries in here.
    metadata: text('metadata'),
    // additionalFields: typed, queryable, defaulted — `planId` is part of the
    // public `Workspace` DTO, so it does not belong in `metadata`.
    planId: text('planId').default('starter').notNull(),
    // Starter-owned, capability-only: when an owner or admin dismissed the
    // workspace's onboarding checklist. Read and written solely by the
    // `workspace-onboarding` capability, never by the plugin — so unlike
    // `planId` it deliberately has no `additionalFields` entry: nothing that
    // goes through a plugin endpoint needs it back. Epoch integer like the
    // rest of this plugin-shaped table.
    onboardingDismissedAt: integer('onboardingDismissedAt', { mode: 'timestamp' }),
    // Capability-owned lifecycle state. Never declare these as organization
    // additionalFields: the plugin must not expose internal reasons to customers.
    suspensionStatus: text('suspensionStatus', { enum: workspaceSuspensionStatuses })
      .default('active')
      .notNull(),
    suspensionInternalReason: text('suspensionInternalReason'),
    suspensionCustomerExplanation: text('suspensionCustomerExplanation'),
    suspensionChangedAt: text('suspensionChangedAt'),
    suspensionTransitionId: text('suspensionTransitionId'),
    suspensionChangedByUserId: text('suspensionChangedByUserId').references(
      () => user.id,
      { onDelete: 'set null' }
    ),
    ...authTimestamps()
  },
  (table) => [
    // The child side of the only workspace foreign key that had no index: a
    // `set null` cascade scans this column for every deleted user.
    index('workspaces_suspension_changed_by_idx').on(table.suspensionChangedByUserId)
  ]
)

/** Capability-owned permit for the plugin's member-first workspace teardown. */
export const workspaceDeletionFences = sqliteTable('workspace_deletion_fences', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  purpose: text('purpose', { enum: ['deletion', 'security_recovery'] })
    .notNull()
    .default('deletion')
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    // The plugin addresses members by a surrogate id (`removeMember`,
    // `updateMemberRole`), so the old composite primary key becomes the unique
    // index below. One membership per user per workspace still holds.
    id: id(),
    workspaceId: workspaceRef('workspaceId'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRoles }).default('member').notNull(),
    createdAt: authCreatedAt()
  },
  (table) => [
    // Replaces the old primary key. Covers plain workspaceId lookups too
    // (leftmost prefix), so the plugin's index on that column is satisfied.
    uniqueIndex('workspace_members_workspace_id_user_id_idx').on(
      table.workspaceId,
      table.userId
    ),
    index('workspace_members_user_idx').on(table.userId)
  ]
)

export const workspaceInvitations = sqliteTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: workspaceRef('workspaceId'),
    email: text('email').notNull(),
    // Optional in the plugin's schema: an invitation may carry no role and
    // fall back to the plugin's default on accept.
    role: text('role', { enum: workspaceRoles }),
    status: text('status', { enum: invitationStatuses }).default('pending').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    // Database triggers stamp plugin-owned terminal transitions atomically.
    terminalAt: integer('terminalAt', { mode: 'timestamp' }),
    inviterId: text('inviterId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [
    workspaceIdIndex('workspace_invitations', table.workspaceId),
    index('workspace_invitations_email_idx').on(table.email),
    index('workspace_invitations_inviter_id_idx').on(table.inviterId),
    index('workspace_invitations_retention_idx').on(
      sql`CASE WHEN status = 'pending' THEN expiresAt ELSE terminalAt END`,
      table.id
    )
  ]
)

// Owned by Better Auth's `sso` plugin, same rules as the three organization
// tables above: the export key must stay the plugin's model name (`ssoProvider`
// is remapped onto `workspaceSsoConnections` in `packages/auth`), and the
// column shape is the plugin's — camelCase fields, a JSON-stringified config
// per protocol (plain `text`, like `workspaces.metadata`, because the plugin
// stringify/parses it itself), an epoch-integer `createdAt` via
// `additionalFields`. The starter's own columns (`enabled`, `requireSso`,
// `defaultWorkspaceRole`) are plugin `additionalFields`, not stray columns, so
// the plugin's register/update endpoints accept and return them.
export const workspaceSsoConnections = sqliteTable(
  'workspace_sso_connections',
  {
    id: id(),
    issuer: text('issuer').notNull(),
    // JSON-stringified OIDC / SAML config blobs written by the plugin. The
    // OIDC blob carries the client secret — reads go through the capability's
    // sanitized projection, never the raw column.
    oidcConfig: text('oidcConfig'),
    samlConfig: text('samlConfig'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('providerId').unique().notNull(),
    // The plugin names its foreign key `organizationId`; the column spells it
    // the starter's way, remapped in `packages/auth` like `workspaceMembers`.
    workspaceId: workspaceRef('workspaceId'),
    domain: text('domain').notNull(),
    // additionalFields — see the comment above the table.
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    requireSso: integer('requireSso', { mode: 'boolean' }).default(false).notNull(),
    defaultWorkspaceRole: text('defaultWorkspaceRole', {
      enum: ssoProvisionedRoles
    })
      .default('member')
      .notNull(),
    createdAt: authCreatedAt()
  },
  (table) => [
    workspaceIdIndex('workspace_sso_connections', table.workspaceId),
    index('workspace_sso_connections_user_id_idx').on(table.userId),
    // The sign-in domain-routing lookup scans by domain first; the plugin
    // allows one IdP to serve several comma-separated domains, so this is an
    // index, not a unique constraint.
    index('workspace_sso_connections_domain_idx').on(table.domain)
  ]
)
