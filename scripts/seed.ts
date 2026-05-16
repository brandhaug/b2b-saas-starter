import {
  ApiTokenRegistry,
  AuditEventLog,
  CatalogRefreshHistory,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  selectWorkspaceLayer,
  StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  WorkspaceMembership
} from '@b2b-saas-starter/capabilities'
import { Effect } from 'effect'

const quote = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value !== 'string') return quote(JSON.stringify(value))
  return `'${String(value).replaceAll("'", "''")}'`
}

const json = (value: unknown): string => quote(JSON.stringify(value))

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const hash = (value: string): Effect.Effect<string> =>
  Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(bytesToHex)
  )

const insert = (table: string, row: Record<string, unknown>): string =>
  `INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(quote).join(', ')});`

const now = '2026-05-16T09:00:00.000Z'
const workspaceSlug = 'starter-lab'

const collectFixture = Effect.gen(function* () {
  const membership = yield* WorkspaceMembership
  const catalog = yield* StarterModuleCatalog
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const integrations = yield* IntegrationSurfaces
  const reports = yield* ImplementationReports
  const audit = yield* AuditEventLog
  const notifications = yield* NotificationFeed
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
    notifications: yield* notifications.list,
    refreshRuns: yield* refresh.listRecent
  }
})

type Fixture = Effect.Success<typeof collectFixture>

const buildStatements = (fixture: Fixture) =>
  Effect.gen(function* () {
    const statements: string[] = ['PRAGMA foreign_keys = ON;']

    statements.push(
      insert('workspaces', {
        id: fixture.workspace.id,
        slug: fixture.workspace.slug,
        name: fixture.workspace.name,
        plan_id: fixture.workspace.planId,
        created_at: now,
        updated_at: now
      })
    )

    for (const member of fixture.members) {
      statements.push(
        insert('user', {
          id: member.id,
          email: member.email,
          name: member.name,
          role: member.systemRole,
          emailVerified: true,
          createdAt: 1778918400,
          updatedAt: 1778918400
        }),
        insert('workspace_members', {
          workspace_id: fixture.workspace.id,
          user_id: member.id,
          role: member.role,
          created_at: now
        })
      )
    }

    for (const module of fixture.modules) {
      statements.push(
        insert('starter_modules', {
          id: module.id,
          name: module.name,
          summary: module.summary,
          category: module.category,
          docs_path: module.docsPath,
          optional: module.optional
        }),
        insert('workspace_module_states', {
          workspace_id: fixture.workspace.id,
          module_id: module.id,
          status: module.state.status,
          enabled: module.state.enabled,
          missing_config: json(module.state.missingConfig),
          updated_at: module.state.updatedAt
        })
      )
    }

    for (const integration of fixture.integrations) {
      statements.push(
        insert('integration_connections', {
          id: integration.id,
          workspace_id: fixture.workspace.id,
          provider: integration.provider,
          display_name: integration.displayName,
          status: integration.status,
          connected_at: null,
          last_checked_at: now
        })
      )
    }

    yield* Effect.forEach(fixture.tokens, (token) =>
      Effect.gen(function* () {
        const plaintext = `${token.prefix}_token`
        const tokenHash = yield* hash(plaintext)
        statements.push(
          insert('api_tokens', {
            id: token.id,
            workspace_id: fixture.workspace.id,
            name: token.name,
            token_prefix: token.prefix,
            token_hash: tokenHash,
            scopes: json(token.scopes),
            last_used_at: token.lastUsedAt,
            revoked_at: null,
            created_at: token.createdAt,
            created_by_user_id: fixture.members[1]?.id ?? null
          })
        )
      })
    )

    yield* Effect.forEach(fixture.webhooks, (endpoint) =>
      Effect.gen(function* () {
        const secret = `whsec_seed_${endpoint.id}`
        const secretHash = yield* hash(secret)
        statements.push(
          insert('webhook_endpoints', {
            id: endpoint.id,
            workspace_id: fixture.workspace.id,
            url: endpoint.url,
            description: 'Seed workspace webhook endpoint',
            signing_secret: secret,
            signing_secret_hash: secretHash,
            enabled: endpoint.enabled,
            events: json(endpoint.events),
            created_at: now
          })
        )
      })
    )

    for (const report of fixture.reports) {
      statements.push(
        insert('implementation_reports', {
          id: report.id,
          workspace_id: fixture.workspace.id,
          title: report.title,
          status: report.status,
          summary: report.summary,
          created_at: report.createdAt
        })
      )
    }

    for (const event of fixture.auditEvents) {
      statements.push(
        insert('audit_events', {
          id: event.id,
          workspace_id: fixture.workspace.id,
          actor_user_id: fixture.members.find((member) => member.name === event.actor)
            ?.id,
          event_type: event.eventType,
          target_type: event.targetType,
          target_id: event.id,
          metadata: json({ seeded: true }),
          created_at: event.createdAt
        })
      )
    }

    for (const notification of fixture.notifications) {
      statements.push(
        insert('notifications', {
          id: notification.id,
          workspace_id: fixture.workspace.id,
          user_id: fixture.members[0]?.id,
          title: notification.title,
          message: notification.message,
          read_at: notification.read ? now : null,
          created_at: notification.createdAt
        })
      )
    }

    for (const run of fixture.refreshRuns) {
      statements.push(
        insert('catalog_refresh_runs', {
          id: run.id,
          workspace_id: fixture.workspace.id,
          status: run.status,
          started_at: run.startedAt,
          completed_at: run.startedAt,
          summary: json({ modules: run.modules, durationMs: run.durationMs })
        })
      )
    }

    return `${statements.join('\n')}\n`
  })

const writeAndExecute = (sql: string) =>
  Effect.gen(function* () {
    if (process.argv.includes('--print')) {
      yield* Effect.sync(() => process.stdout.write(sql))
      return
    }
    yield* Effect.promise(() => Bun.write('.context/seed-starter-lab.sql', sql))
    const code = yield* Effect.promise(async () => {
      const proc = Bun.spawn(
        [
          'bunx',
          'wrangler',
          'd1',
          'execute',
          'b2b-saas-starter',
          '--local',
          '--file=.context/seed-starter-lab.sql'
        ],
        { stdout: 'inherit', stderr: 'inherit' }
      )
      return proc.exited
    })
    if (code !== 0) {
      yield* Effect.sync(() => process.exit(code))
    }
  })

const program = collectFixture.pipe(
  Effect.flatMap(buildStatements),
  Effect.flatMap(writeAndExecute),
  Effect.provide(selectWorkspaceLayer({}, workspaceSlug))
)

await Effect.runPromise(program)
