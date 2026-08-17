import {
  ApiTokenRegistry,
  AuditEventLog,
  CatalogRefreshHistory,
  demoUserIdentity,
  hashApiToken,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  SEED_API_TOKEN,
  selectWorkspaceLayer,
  StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  WorkspaceMembership
} from '@b2b-saas-starter/capabilities'
import {
  account,
  apiTokens,
  auditEvents,
  catalogRefreshRuns,
  implementationReports,
  integrationConnections,
  notifications,
  starterModules,
  user,
  webhookEndpoints,
  workspaceMembers,
  workspaceModuleStates,
  workspaces
} from '@b2b-saas-starter/db'
import { getColumns, getTableName, type Table } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { hashPassword } from 'better-auth/crypto'

// Demo credential account so the authenticated area is reachable after
// seeding. The identity is the shared `demoUserIdentity` constant from the
// capabilities seed fixture; only the password lives here. Documented in
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
  if (value === null) return 'NULL'
  const asNumber = decodeDriverNumber(value)
  if (Option.isSome(asNumber)) return String(asNumber.value)
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
  const entries: [string, string][] = Object.entries(row).map(([key, value]) => {
    const column = columns[key]
    if (column === undefined) {
      throw new Error(`seed: unknown column ${key} for table ${getTableName(table)}`)
    }
    if (value === null || value === undefined) return [column.name, quote(null)]
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
  const catalog = yield* StarterModuleCatalog
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const integrations = yield* IntegrationSurfaces
  const reports = yield* ImplementationReports
  const audit = yield* AuditEventLog
  const notificationFeed = yield* NotificationFeed
  const refresh = yield* CatalogRefreshHistory
  const ctx = yield* WorkspaceContext
  return {
    workspace: ctx.workspace,
    members: yield* membership.listMembers,
    modules: yield* catalog.listModules,
    tokens: yield* tokens.list,
    webhooks: yield* webhooks.list,
    integrations: yield* integrations.list,
    reports: yield* reports.list,
    auditEvents: yield* audit.listGlobal,
    notifications: yield* notificationFeed.list,
    refreshRuns: yield* refresh.listRecent
  }
})

type Fixture = Effect.Success<typeof collectFixture>

// The first fixture token is seeded from the documented SEED_API_TOKEN so the
// same credential verifies against both the in-memory Seed layer and a seeded
// local D1 (Seed/Live equivalence).
function seedTokenValue(token: Fixture['tokens'][number], index: number): string {
  if (index === 0) return SEED_API_TOKEN
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

function workspaceRows(fixture: Fixture): readonly string[] {
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

function memberRows(fixture: Fixture): readonly string[] {
  return fixture.members.flatMap((member) => [
    insert(user, {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.systemRole,
      emailVerified: true,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    }),
    insert(workspaceMembers, {
      id: membershipId(member.id),
      workspaceId: fixture.workspace.id,
      userId: member.id,
      role: member.role,
      createdAt: new Date(now)
    })
  ])
}

// Demo sign-in: system admin (`role: 'admin'` — Better Auth admin plugin)
// and a member of the seed workspace so the membership gate passes.
function demoUserRows(fixture: Fixture, demoPasswordHash: string): readonly string[] {
  return [
    insert(user, {
      id: demoUserIdentity.id,
      email: demoUserIdentity.email,
      name: demoUserIdentity.name,
      role: demoUserIdentity.systemRole,
      emailVerified: true,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    }),
    insert(account, {
      id: 'acc_demo_credential',
      accountId: demoUserIdentity.id,
      providerId: 'credential',
      userId: demoUserIdentity.id,
      password: demoPasswordHash,
      createdAt: 1_778_918_400,
      updatedAt: 1_778_918_400
    }),
    insert(workspaceMembers, {
      id: membershipId(demoUserIdentity.id),
      workspaceId: fixture.workspace.id,
      userId: demoUserIdentity.id,
      role: demoUserIdentity.role,
      createdAt: new Date(now)
    })
  ]
}

function moduleRows(fixture: Fixture): readonly string[] {
  return fixture.modules.flatMap((module) => [
    insert(starterModules, {
      id: module.id,
      name: module.name,
      summary: module.summary,
      category: module.category,
      docsPath: module.docsPath,
      optional: module.optional
    }),
    insert(workspaceModuleStates, {
      workspaceId: fixture.workspace.id,
      moduleId: module.id,
      status: module.state.status,
      enabled: module.state.enabled,
      missingConfig: module.state.missingConfig,
      updatedAt: module.state.updatedAt
    })
  ])
}

function integrationRows(fixture: Fixture): readonly string[] {
  return fixture.integrations.map((integration) =>
    insert(integrationConnections, {
      id: integration.id,
      workspaceId: fixture.workspace.id,
      provider: integration.provider,
      displayName: integration.displayName,
      status: integration.status,
      connectedAt: null,
      lastCheckedAt: now
    })
  )
}

function tokenRows(
  fixture: Fixture,
  tokenHashes: readonly string[]
): readonly string[] {
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

function webhookRows(fixture: Fixture): readonly string[] {
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

function reportRows(fixture: Fixture): readonly string[] {
  return fixture.reports.map((report) =>
    insert(implementationReports, {
      id: report.id,
      workspaceId: fixture.workspace.id,
      title: report.title,
      status: report.status,
      summary: report.summary,
      createdAt: report.createdAt
    })
  )
}

function auditRows(fixture: Fixture): readonly string[] {
  return fixture.auditEvents.map((event) =>
    insert(auditEvents, {
      id: event.id,
      workspaceId: fixture.workspace.id,
      actorUserId: fixture.members.find((member) => member.name === event.actor)?.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.id,
      metadata: { seeded: true },
      createdAt: event.createdAt
    })
  )
}

function readAt(read: boolean): string | null {
  if (read) return now
  return null
}

function notificationRows(fixture: Fixture): readonly string[] {
  return fixture.notifications.map((notification) =>
    insert(notifications, {
      id: notification.id,
      workspaceId: fixture.workspace.id,
      userId: null,
      title: notification.title,
      message: notification.message,
      readAt: readAt(notification.read),
      createdAt: notification.createdAt
    })
  )
}

function refreshRunRows(fixture: Fixture): readonly string[] {
  return fixture.refreshRuns.map((run) =>
    insert(catalogRefreshRuns, {
      id: run.id,
      workspaceId: fixture.workspace.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.startedAt,
      summary: { modules: run.modules, durationMs: run.durationMs }
    })
  )
}

function buildStatements(fixture: Fixture, hashes: Hashes): string {
  return `${[
    'PRAGMA foreign_keys = ON;',
    ...workspaceRows(fixture),
    ...memberRows(fixture),
    ...demoUserRows(fixture, hashes.demoPassword),
    ...moduleRows(fixture),
    ...integrationRows(fixture),
    ...tokenRows(fixture, hashes.tokens),
    ...webhookRows(fixture),
    ...reportRows(fixture),
    ...auditRows(fixture),
    ...notificationRows(fixture),
    ...refreshRunRows(fixture)
  ].join('\n')}\n`
}

// This script runs on Bun at development time and shells out to `wrangler d1
// execute`; the CLI argv, stdout, file write, subprocess, and exit code below
// are the Bun/process platform APIs that job needs. The Effect platform
// equivalents (CommandExecutor, FileSystem) would mean wiring a BunContext
// layer into a script whose whole output is one SQL file and one CLI call.
function writeAndExecute(sql: string) {
  return Effect.gen(function* () {
    if (process.argv.includes('--print')) {
      yield* Effect.sync(() => process.stdout.write(sql))
      return
    }
    yield* Effect.promise(() => Bun.write('.context/seed-starter-lab.sql', sql))
    const code = yield* Effect.promise(
      () =>
        Bun.spawn(
          [
            'bunx',
            'wrangler',
            'd1',
            'execute',
            'b2b-saas-starter',
            '--local',
            // Use the db package's wrangler config so the seed lands in the
            // same local D1 state that `bun run db:migrate:local` targets.
            '--config=packages/db/wrangler.jsonc',
            '--file=.context/seed-starter-lab.sql'
          ],
          { stdout: 'inherit', stderr: 'inherit' }
        ).exited
    )
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
