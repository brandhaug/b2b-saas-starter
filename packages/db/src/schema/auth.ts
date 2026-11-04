import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { systemRoles, accountLocales } from '../enums.ts'
import { id, authCreatedAt, authTimestamps } from './columns.ts'

export const user = sqliteTable('user', {
  id: id(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).default(false).notNull(),
  // The admin plugin's system role. Nullable because the plugin declares the
  // field optional — a row written before the default, or by a path that omits
  // it, reads as `null` and means `user`.
  role: text('role', { enum: systemRoles }).default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('banReason'),
  banExpires: integer('banExpires', { mode: 'timestamp' }),
  // The twoFactor plugin declares this field on `user` (input: false — only
  // its own verify/disable endpoints flip it), so the column must exist for
  // the plugin writes to land.
  twoFactorEnabled: integer('twoFactorEnabled', { mode: 'boolean' })
    .default(false)
    .notNull(),
  // Optional account preferences. Null means the user has not selected a
  // locale or timezone; callers apply the platform defaults (`en`/`UTC`).
  locale: text('locale', { enum: accountLocales }),
  timeZone: text('timeZone'),
  ...authTimestamps()
})

export const session = sqliteTable(
  'session',
  {
    id: id(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').unique().notNull(),
    ...authTimestamps(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy'),
    // The organization plugin declares this field on `session` unconditionally
    // — there is no config that switches it off — so the column must exist or
    // every plugin write against `session` fails. Whether the starter *reads*
    // it is ticket 03's call; slug-per-request resolution means it probably
    // will not.
    activeOrganizationId: text('activeOrganizationId'),
    passwordVerifiedAt: integer('passwordVerifiedAt', { mode: 'timestamp' }),
    strongAuthAt: integer('strongAuthAt', { mode: 'timestamp' }),
    strongAuthMethod: text('strongAuthMethod'),
    strongAuthCredentialId: text('strongAuthCredentialId'),
    recoveryUntil: integer('recoveryUntil', { mode: 'timestamp' })
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expiry_idx').on(table.expiresAt, table.id)
  ]
)

export const account = sqliteTable(
  'account',
  {
    id: id(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    // Better Auth 1.7.3+ no longer writes issuer for account rows.
    issuer: text('issuer'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', {
      mode: 'timestamp'
    }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
      mode: 'timestamp'
    }),
    scope: text('scope'),
    password: text('password'),
    ...authTimestamps()
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_accountId_uidx').on(table.issuer, table.accountId)
  ]
)

export const verification = sqliteTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    ...authTimestamps()
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expiry_idx').on(table.expiresAt, table.id)
  ]
)

// Owned by Better Auth's `twoFactor` plugin — the export key must stay the
// plugin's model name (`twoFactor`) because the drizzle adapter resolves
// `schema[modelName]`. One row per user; the secret is encrypted at rest by
// the plugin with the auth secret.
export const twoFactor = sqliteTable(
  'two_factor',
  {
    id: id(),
    secret: text('secret').notNull(),
    // A JSON string of the hashed backup codes — the plugin encodes and
    // decodes it itself, so plain `text`, like `workspaces.metadata`.
    backupCodes: text('backupCodes').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: integer('verified', { mode: 'boolean' }).default(true).notNull(),
    failedVerificationCount: integer('failedVerificationCount').default(0).notNull(),
    lockedUntil: integer('lockedUntil', { mode: 'timestamp' }),
    ...authTimestamps()
  },
  (table) => [
    index('two_factor_user_id_idx').on(table.userId),
    index('two_factor_secret_idx').on(table.secret)
  ]
)

// Owned by Better Auth's `passkey` plugin — the export key must stay the
// plugin's model name (`passkey`) because the drizzle adapter resolves
// `schema[modelName]`. One row per registered WebAuthn credential; the public
// key is the verifier's input, never a secret. Plugin-owned shape: camelCase
// columns, epoch-integer dates (ADR 0056).
export const passkey = sqliteTable(
  'passkey',
  {
    id: id(),
    // User-chosen label for the management UI; the plugin leaves it absent
    // when the ceremony carried no name.
    name: text('name'),
    publicKey: text('publicKey').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credentialID').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('deviceType').notNull(),
    backedUp: integer('backedUp', { mode: 'boolean' }).notNull(),
    // Comma-separated WebAuthn transport list; the plugin splits and joins it
    // itself, so plain `text`, like `two_factor.backupCodes`.
    transports: text('transports'),
    createdAt: authCreatedAt(),
    // The authenticator model's identifier, best-effort label source.
    aaguid: text('aaguid')
  },
  (table) => [
    index('passkey_user_id_idx').on(table.userId),
    index('passkey_credential_id_idx').on(table.credentialID)
  ]
)
