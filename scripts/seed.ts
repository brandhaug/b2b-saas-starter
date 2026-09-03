import {
  account,
  apiTokens,
  auditEvents,
  notificationPreferences,
  notifications,
  oauthClient,
  oauthConsent,
  user,
  webhookDeliveries,
  webhookEndpoints,
  workspaceMembers,
  workspaceSsoConnections,
  workspaceSubscriptions,
  workspaces
} from '@b2b-saas-starter/db/schema'
import {
  ApiTokenRegistry,
  hashApiToken,
  SEED_API_TOKEN
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  demoMemberIdentity,
  demoUserIdentity,
  seedMcpClientConnections,
  seedMcpClients,
  seedSsoConnections
} from '@b2b-saas-starter/capabilities/seed-fixture'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { selectWorkspaceLayer } from '@b2b-saas-starter/capabilities/runtime'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'

import { getColumns, getTableName, type Table } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { hashPassword } from 'better-auth/crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The seed writes `.context/…` and targets `packages/db/wrangler.jsonc` with
// root-relative paths, so it pins its own cwd instead of trusting the caller's.
const repoRoot = join(import.meta.dirname, '..')

// Demo credential accounts so the authenticated area is reachable after
// seeding. The identities are the shared `demoUserIdentity` /
// `demoMemberIdentity` constants from the capabilities seed fixture, and their
// user and membership rows come from the Seed layer like every other
// identity's; only the password lives here. Documented in
// docs/setup.md and on the sign-in screen (apps/web/src/lib/demo-workspace.ts
// must stay in sync).
//
// The password hash comes from Better Auth's own `hashPassword`
// (better-auth/crypto) so it verifies against `signIn.email`. We don't call
// `auth.api.signUpEmail` here because the app's auth instance includes the
// TanStack Start cookie plugin, which requires a live request context that a
// seed script doesn't have — and this script's design is to emit plain SQL
// executed through `wrangler d1 execute`.
const DEMO_USER_PASSWORD = 'demo-starter-password'

// mapToDriverValue only yields string | number | null for this schema; parse
// for that rather than probing, so anything else fails loudly here instead of
// silently serializing as '[object Object]'.
const decodeDriverNumber = Schema.decodeUnknownOption(Schema.Number)
const decodeDriverString = Schema.decodeUnknownOption(Schema.String)

function quote(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }
  const asNumber = decodeDriverNumber(value)
  if (Option.isSome(asNumber)) {
    return String(asNumber.value)
  }
  const asString = decodeDriverString(value)
  if (Option.isNone(asString)) {
    // JSON rather than `String(value)`: an object would stringify to
    // '[object Object]' and the message would name nothing useful.
    throw new TypeError(`unsupported driver value: ${JSON.stringify(value)}`)
  }
  return `'${asString.value.replaceAll("'", "''")}'`
}

// Insert statements are derived from the Drizzle schema: rows are keyed by the
// table's TS property names (a typo is a compile error), the SQL table and
// column names come from `getTableName`/`getColumns`, and values pass
// through each column's `mapToDriverValue` (JSON stringify, boolean → 0/1) —
// so a schema rename breaks the seed loudly at compile time instead of
// drifting silently against `packages/db`.
function insert<T extends Table>(
  table: T,
  row: { readonly [K in keyof T['_']['columns']]?: unknown }
): string {
  const columns = getColumns(table)
  const entries: Array<[string, string]> = Object.entries(row).map(([key, value]) => {
    const column = columns[key]
    if (column === undefined) {
      throw new Error(`seed: unknown column ${key} for table ${getTableName(table)}`)
    }
    if (value === null || value === undefined) {
      return [column.name, quote(null)]
    }
    return [column.name, quote(column.mapToDriverValue(value))]
  })
  return `INSERT OR REPLACE INTO ${getTableName(table)} (${entries.map(([name]) => name).join(', ')}) VALUES (${entries.map(([, value]) => value).join(', ')});`
}

const now = '2026-05-16T09:00:00.000Z'
const workspaceSlug = 'starter-lab'

/**
 * Membership rows now carry a surrogate id (the organization plugin addresses
 * members by it). The seed runs `INSERT OR REPLACE`, so the id has to be
 * derived, not random, or a re-seed would stack duplicate rows.
 */
function membershipId(userId: string): string {
  return `mem_${userId}`
}

const collectFixture = Effect.gen(function* () {
  const membership = yield* WorkspaceMembership
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const audit = yield* AuditEventLog
  const notificationFeed = yield* NotificationFeed
  const notificationPrefs = yield* NotificationPreferences
  const userAdmin = yield* PlatformUserAdmin
  const ctx = yield* WorkspaceContext
  const endpoints = yield* webhooks.list
  return {
    workspace: ctx.workspace,
    // Every account the Seed layer describes, members and non-members alike:
    // `/admin` lists these, so a D1 missing the membership-less ones would
    // show a shorter list under Live than under Seed.
    accounts: yield* userAdmin.listUsers,
    members: yield* membership.listMembers,
    tokens: yield* tokens.list,
    webhooks: endpoints,
    deliveries: yield* Effect.forEach(endpoints, (endpoint) =>
      webhooks.listDeliveries({ endpointId: endpoint.id })
    ),
    auditEvents: yield* audit.listGlobal,
    notifications: yield* notificationFeed.list,
    // The demo owner's explicit email choices — only the non-default rows are
    // stored, exactly as the Live adapter would after the user picked them.
    notificationPreferences: yield* Effect.map(
      notificationPrefs.list(demoUserIdentity.id),
      (resolved) => resolved.filter((preference) => !preference.isDefault)
    )
  }
})

type Fixture = Effect.Success<typeof collectFixture>

// The first fixture token is seeded from the documented SEED_API_TOKEN so the
// same credential verifies against both the in-memory Seed layer and a seeded
// local D1 (Seed/Live equivalence).
function seedTokenValue(token: Fixture['tokens'][number], index: number): string {
  if (index === 0) {
    return SEED_API_TOKEN
  }
  return `${token.prefix}_token`
}

function resolveHashes(fixture: Fixture) {
  return Effect.all({
    demoPassword: Effect.promise(() => hashPassword(DEMO_USER_PASSWORD)),
    // `hashApiToken` is the registry's own hashing scheme.
    tokens: Effect.forEach(fixture.tokens, (token, index) =>
      Effect.promise(() => hashApiToken(seedTokenValue(token, index)))
    )
  })
}

type Hashes = Effect.Success<ReturnType<typeof resolveHashes>>

function workspaceRows(fixture: Fixture): ReadonlyArray<string> {
  return [
    insert(workspaces, {
      id: fixture.workspace.id,
      slug: fixture.workspace.slug,
      name: fixture.workspace.name,
      planId: fixture.workspace.planId,
      // Plugin-owned table: epoch integers, so the value has to be a Date.
      // `now` stays an ISO string for the starter's own text columns.
      createdAt: new Date(now),
      updatedAt: new Date(now)
    })
  ]
}

/** One `user` row per account the Seed layer knows, membership or not. */
function userRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.accounts.map((identity) =>
    insert(user, {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      role: identity.systemRole,
      banned: identity.banned,
      emailVerified: true,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    })
  )
}

/** The membership half: only the accounts the fixture puts in the workspace. */
function membershipRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.members.map((member) =>
    insert(workspaceMembers, {
      id: membershipId(member.id),
      workspaceId: fixture.workspace.id,
      userId: member.id,
      role: member.role,
      createdAt: new Date(now)
    })
  )
}

/**
 * The two fixture identities that get a local sign-in: the demo owner (a system
 * admin, so `/admin` is reachable) and the plain `member` whose role-gated UI
 * differs from an owner's. Their user and membership rows come from
 * `userRows`/`membershipRows` like everyone else's — only the credential is
 * here. Both share the demo password: the point is to make both roles
 * reachable by hand, not to model two secrets.
 *
 * The account ids are fixed rather than derived, because the seed runs
 * `INSERT OR REPLACE` and a changed id would stack a second credential row.
 */
const credentialAccounts: ReadonlyArray<{
  readonly accountRowId: string
  readonly userId: string
}> = [
  { accountRowId: 'acc_demo_credential', userId: demoUserIdentity.id },
  { accountRowId: 'acc_member_credential', userId: demoMemberIdentity.id }
]

function credentialRows(demoPasswordHash: string): ReadonlyArray<string> {
  return credentialAccounts.map((credential) =>
    insert(account, {
      id: credential.accountRowId,
      accountId: credential.userId,
      providerId: 'credential',
      // better-auth 1.7 keys credential accounts on this synthetic issuer.
      issuer: 'local:credential',
      userId: credential.userId,
      password: demoPasswordHash,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    })
  )
}

/**
 * A linked social provider for the demo owner, so `/account` shows the
 * linked-providers surface on the seeded reference app: one provider row next
 * to the credential row, unlinkable because another sign-in method remains.
 * The account id names no real GitHub subject — signing in *as* it is not
 * possible, it is fixture state for the account page exactly like the seed
 * webhook endpoints are fixture state for the settings page.
 */
const linkedProviderAccounts: ReadonlyArray<{
  readonly accountRowId: string
  readonly userId: string
  readonly providerId: 'github' | 'google'
  readonly accountId: string
  readonly issuer: string
}> = [
  {
    accountRowId: 'acc_demo_github',
    userId: demoUserIdentity.id,
    providerId: 'github',
    accountId: '99000001',
    // GitHub exposes no OIDC issuer; better-auth keys its accounts on this
    // synthetic namespace (same value the live flow writes).
    issuer: 'local:oauth:github'
  }
]

function linkedProviderRows(): ReadonlyArray<string> {
  return linkedProviderAccounts.map((linked) =>
    insert(account, {
      id: linked.accountRowId,
      accountId: linked.accountId,
      providerId: linked.providerId,
      issuer: linked.issuer,
      userId: linked.userId,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    })
  )
}

function tokenRows(
  fixture: Fixture,
  tokenHashes: ReadonlyArray<string>
): ReadonlyArray<string> {
  return fixture.tokens.map((token, index) =>
    insert(apiTokens, {
      id: token.id,
      workspaceId: fixture.workspace.id,
      name: token.name,
      tokenPrefix: token.prefix,
      tokenHash: tokenHashes[index],
      scopes: token.scopes,
      lastUsedAt: token.lastUsedAt,
      revokedAt: null,
      createdAt: token.createdAt,
      createdByUserId: fixture.members[1]?.id ?? null
    })
  )
}

function webhookRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.webhooks.map((endpoint) =>
    insert(webhookEndpoints, {
      id: endpoint.id,
      workspaceId: fixture.workspace.id,
      url: endpoint.url,
      description: 'Seed workspace webhook endpoint',
      signingSecret: `whsec_seed_${endpoint.id}`,
      enabled: endpoint.enabled,
      events: endpoint.events,
      createdAt: now
    })
  )
}

/**
 * The delivery history rows behind the operator tooling: the failed seed
 * delivery and its evidence columns so the seeded D1 shows the same
 * deliveries drawer — replay button included — as the in-memory Seed layer.
 */
function webhookDeliveryRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.deliveries.flatMap((deliveries) =>
    deliveries.map((delivery) =>
      insert(webhookDeliveries, {
        id: delivery.id,
        endpointId: delivery.endpointId,
        eventType: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        lastAttemptAt: delivery.lastAttemptAt,
        nextAttemptAt: delivery.nextAttemptAt,
        responseStatus: delivery.responseStatus,
        payload: delivery.payload,
        requestHeaders: delivery.requestHeaders,
        responseBody: delivery.responseBody,
        replayedFrom: delivery.replayedFrom
      })
    )
  )
}

function auditRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.auditEvents.map((event) =>
    insert(auditEvents, {
      id: event.id,
      // A row is workspace-scoped only when it says so; omitted means
      // system-level, exactly how the Seed adapter filters in memory —
      // system events (admin mutations, account security) never leak into a
      // workspace trail.
      workspaceId: event.workspaceId ?? null,
      actorUserId: fixture.members.find((member) => member.name === event.actor)?.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.id,
      metadata: { seeded: true },
      createdAt: event.createdAt
    })
  )
}

/**
 * The fixture MCP Client and the demo owner's consent to it (ADR 0054). Both
 * tables are the OAuth provider's: epoch-integer dates, camelCase columns. The
 * consent's `referenceId` is the workspace the consent page picked.
 */
function mcpClientRows(): ReadonlyArray<string> {
  return [
    ...seedMcpClients.map((client) =>
      insert(oauthClient, {
        id: `oac_${client.clientId.replaceAll(/[^a-z0-9]/gi, '_').slice(-40)}`,
        clientId: client.clientId,
        name: client.name,
        uri: client.uri,
        clientDiscoveryId: 'cimd',
        disabled: false,
        scopes: ['openid', 'profile', 'email', 'offline_access', 'mcp:read'],
        clientCredentialsScopes: [],
        redirectUris: ['http://127.0.0.1:33418/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        requirePKCE: true,
        dpopBoundAccessTokens: false,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      })
    ),
    ...seedMcpClientConnections.map((connection) =>
      insert(oauthConsent, {
        id: connection.id,
        clientId: connection.client.clientId,
        userId: demoUserIdentity.id,
        referenceId: connection.workspace?.id ?? null,
        resources: ['http://localhost:8787/mcp'],
        scopes: connection.scopes,
        createdAt: new Date(connection.grantedAt),
        updatedAt: new Date(connection.grantedAt)
      })
    )
  ]
}

function readAt(read: boolean): string | null {
  if (read) {
    return now
  }
  return null
}

/**
 * The SSO connection rows come from the fixture through the same capability
 * read the settings page uses. The example OIDC connection's config blob is
 * JSON exactly as the plugin stores it; `enabled: false` keeps its domain
 * from routing sign-ins (ADR 0055).
 */
function ssoConnectionRows(fixture: {
  readonly workspace: { readonly id: string }
}): ReadonlyArray<string> {
  return seedSsoConnections.map((connection) =>
    insert(workspaceSsoConnections, {
      id: `row_${connection.id}`,
      issuer: connection.issuer,
      oidcConfig:
        connection.protocol === 'oidc'
          ? JSON.stringify({
              // A full example client id for the stored blob. The DTO only
              // ever carries the last four (the fixture's `7f2a`), so the
              // fixture cannot supply this — the value is for the local D1
              // row only.
              clientId: 'seed-client-7f2a',
              authorizationEndpoint: connection.oidc.authorizationEndpoint,
              tokenEndpoint: connection.oidc.tokenEndpoint,
              jwksEndpoint: connection.oidc.jwksEndpoint
            })
          : null,
      samlConfig: null,
      userId: demoUserIdentity.id,
      providerId: connection.id,
      workspaceId: fixture.workspace.id,
      domain: connection.domain,
      enabled: connection.enabled,
      requireSso: connection.requireSso,
      defaultWorkspaceRole: connection.defaultWorkspaceRole,
      createdAt: new Date(connection.createdAt)
    })
  )
}

function notificationRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.notifications.map((notification) =>
    insert(notifications, {
      id: notification.id,
      workspaceId: fixture.workspace.id,
      userId: null,
      kind: notification.kind,
      title: notification.title,
      message: notification.message,
      readAt: readAt(notification.read),
      createdAt: notification.createdAt
    })
  )
}

/**
 * The Seed Workspace's simulated provider subscription: a customer, a seat
 * item, and the quantity its four members bill as on the per-seat Team plan.
 * Fixture values only — the workspace's Stripe state lives in
 * `workspace_subscriptions` and is written by provider events in production,
 * but the demo should render seat usage and (with Stripe configured) the
 * portal without anyone checking out first.
 */
function subscriptionRows(fixture: Fixture): ReadonlyArray<string> {
  return [
    insert(workspaceSubscriptions, {
      workspaceId: fixture.workspace.id,
      stripeCustomerId: 'cus_seed_starter_lab',
      stripeSubscriptionId: 'sub_seed_starter_lab',
      stripeSubscriptionItemId: 'si_seed_starter_lab',
      seatQuantity: fixture.members.length,
      updatedAt: now
    })
  ]
}

/**
 * One row per explicit choice of the demo owner. The id is derived from the
 * (user, kind) pair the unique index covers, so `INSERT OR REPLACE` re-seeds
 * in place instead of tripping the index.
 */
function notificationPreferenceRows(fixture: Fixture): ReadonlyArray<string> {
  return fixture.notificationPreferences.map((preference) =>
    insert(notificationPreferences, {
      id: `npref_${demoUserIdentity.id}_${preference.kind.replaceAll('.', '_')}`,
      userId: demoUserIdentity.id,
      kind: preference.kind,
      channel: preference.channel,
      updatedAt: now
    })
  )
}

function buildStatements(fixture: Fixture, hashes: Hashes): string {
  return `${[
    'PRAGMA foreign_keys = ON;',
    ...workspaceRows(fixture),
    ...userRows(fixture),
    ...membershipRows(fixture),
    ...credentialRows(hashes.demoPassword),
    ...linkedProviderRows(),
    ...tokenRows(fixture, hashes.tokens),
    ...webhookRows(fixture),
    ...ssoConnectionRows(fixture),
    ...subscriptionRows(fixture),
    ...webhookDeliveryRows(fixture),
    ...mcpClientRows(),
    ...auditRows(fixture),
    ...notificationRows(fixture),
    ...notificationPreferenceRows(fixture)
  ].join('\n')}\n`
}

// Where the SQL lands. Default: the persisted local D1 that `db:migrate:local`
// targets. `--remote --database=<name>` executes against a deployed D1 by name
// instead — the preview workflow seeds each `pr-<number>` stage's database this
// way so the preview shows the Seed Workspace (ADR 0054). Remote mode passes no
// wrangler config: the db package's config names the production database, and
// wrangler resolves a bare name through the account (CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID) instead.
type SeedTarget =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly database: string }

function resolveTarget(argv: ReadonlyArray<string>): SeedTarget {
  const remote = argv.includes('--remote')
  const database = argv
    .find((arg) => arg.startsWith('--database='))
    ?.slice('--database='.length)
  if (!remote && database === undefined) {
    return { kind: 'local' }
  }
  if (!remote || !database) {
    throw new Error(
      'seed: remote seeding needs both --remote and --database=<d1 name> (e.g. b2b-saas-starter-pr-42)'
    )
  }
  return { kind: 'remote', database }
}

// Resolved up front so a bad flag fails before the fixture is built or the SQL
// file is written.
const seedTarget = resolveTarget(process.argv)

function wranglerArgs(target: SeedTarget, file: string): ReadonlyArray<string> {
  if (target.kind === 'remote') {
    return ['d1', 'execute', target.database, '--remote', `--file=${file}`]
  }
  return [
    'd1',
    'execute',
    'b2b-saas-starter',
    '--local',
    // Use the db package's wrangler config so the seed lands in the
    // same local D1 state that `db:migrate:local` targets.
    '--config=packages/db/wrangler.jsonc',
    `--file=${file}`
  ]
}

// This script runs on Node at development time and shells out to `wrangler d1
// execute`; the CLI argv, stdout, file write, subprocess, and exit code below
// are the Node/process platform APIs that job needs. The Effect platform
// equivalents (CommandExecutor, FileSystem) would mean wiring a NodeContext
// layer into a script whose whole output is one SQL file and one CLI call.
function writeAndExecute(sql: string) {
  return Effect.gen(function* () {
    if (process.argv.includes('--print')) {
      yield* Effect.sync(() => process.stdout.write(sql))
      return
    }
    yield* Effect.promise(() =>
      mkdir(join(repoRoot, '.context'), { recursive: true }).then(() =>
        writeFile(join(repoRoot, '.context', 'seed-starter-lab.sql'), sql, 'utf8')
      )
    )
    const code = yield* Effect.callback<number>((resume) => {
      // The wrangler bin of the root workspace's own node_modules.
      const wranglerBin = fileURLToPath(
        new URL('../node_modules/.bin/wrangler', import.meta.url)
      )
      const child = spawn(
        wranglerBin,
        [...wranglerArgs(seedTarget, '.context/seed-starter-lab.sql')],
        { stdio: ['ignore', 'inherit', 'inherit'], cwd: repoRoot }
      )
      child.on('exit', (exitCode) => resume(Effect.succeed(exitCode ?? 1)))
      child.on('error', () => resume(Effect.succeed(1)))
    })
    if (code !== 0) {
      yield* Effect.sync(() => process.exit(code))
    }
  })
}

const program = collectFixture.pipe(
  Effect.flatMap((fixture) =>
    resolveHashes(fixture).pipe(
      Effect.map((hashes) => buildStatements(fixture, hashes))
    )
  ),
  Effect.flatMap(writeAndExecute),
  Effect.provide(selectWorkspaceLayer({}, workspaceSlug))
)

// Script entrypoint: the top-level await is what makes a failed seed reject
// and exit the Bun process non-zero. There is no enclosing Effect to yield in.
await Effect.runPromise(program)
