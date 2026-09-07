import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

import { DateTime, Effect, Option, Schema } from 'effect'
import { normalizeSsoDomain } from '@b2b-saas-starter/capabilities/governance/sso-policy'

type FetchImplementation = typeof globalThis.fetch
type Environment = Readonly<Record<string, string | undefined>>

const API_ROOT = 'https://api.cloudflare.com/client/v4'

const CloudflareError = Schema.Struct({ message: Schema.String })
const D1QueryResult = Schema.Struct({
  results: Schema.optionalKey(
    Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
  )
})
const CloudflareEnvelope = Schema.Struct({
  success: Schema.Boolean,
  errors: Schema.optionalKey(Schema.Array(CloudflareError)),
  result: Schema.optionalKey(Schema.Array(D1QueryResult))
})
const decodeEnvelope = Schema.decodeUnknownEffect(CloudflareEnvelope)
const decodeStringOption = Schema.decodeUnknownOption(Schema.String)
const decodeWorkspaceOwner = Schema.decodeUnknownOption(
  Schema.Struct({
    workspace_id: Schema.String,
    workspace_slug: Schema.String,
    user_id: Schema.String
  })
)
const decodeErrorOption = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.String })
)
const decodeClaimId = Schema.decodeUnknownOption(Schema.String)

type Query = {
  readonly sql: string
  readonly params: ReadonlyArray<string>
}

type OperatorConfig = {
  readonly accountId: string
  readonly apiToken: string
  readonly databaseId: string
}

type CommonOptions = {
  readonly command: 'grant' | 'transfer-domain'
  readonly operatorId: string
  readonly reason: string
  readonly execute: boolean
  readonly databaseId?: string | undefined
}

type GrantOptions = CommonOptions & {
  readonly command: 'grant'
  readonly workspaceId: string
  readonly ownerUserId: string
}

type TransferOptions = CommonOptions & {
  readonly command: 'transfer-domain'
  readonly domain: string
  readonly expectedWorkspaceId: string
  readonly targetWorkspaceId: string
}

type CliOptions = GrantOptions | TransferOptions

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function optionString(value: string | boolean | undefined): string | undefined {
  return Option.getOrUndefined(decodeStringOption(value))
}

export function parseCli(rawArgs: ReadonlyArray<string>): CliOptions {
  const separator = rawArgs.indexOf('--')
  const args = separator === -1 ? rawArgs : rawArgs.slice(separator + 1)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      owner: { type: 'string' },
      operator: { type: 'string' },
      reason: { type: 'string' },
      database: { type: 'string' },
      domain: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      execute: { type: 'boolean' }
    }
  })
  const command = parsed.positionals[0]
  const common = {
    operatorId: required(optionString(parsed.values.operator), '--operator <id>'),
    reason: required(optionString(parsed.values.reason), '--reason <ticket-or-note>'),
    execute: parsed.values.execute === true,
    databaseId: optionString(parsed.values.database)
  }
  if (command === 'grant') {
    return {
      command,
      ...common,
      workspaceId: required(optionString(parsed.values.workspace), '--workspace <id>'),
      ownerUserId: required(optionString(parsed.values.owner), '--owner <user-id>')
    }
  }
  if (command === 'transfer-domain') {
    const domain = normalizeSsoDomain(
      required(optionString(parsed.values.domain), '--domain <exact-domain>')
    )
    if (domain === undefined) {
      throw new Error('--domain must be an exact email domain')
    }
    const expectedWorkspaceId = required(
      optionString(parsed.values.from),
      '--from <workspace-id>'
    )
    const targetWorkspaceId = required(
      optionString(parsed.values.to),
      '--to <workspace-id>'
    )
    if (expectedWorkspaceId === targetWorkspaceId) {
      throw new Error('--from and --to must name different workspaces')
    }
    return {
      command,
      ...common,
      domain,
      expectedWorkspaceId,
      targetWorkspaceId
    }
  }
  throw new Error(
    'Usage: sso-recovery.ts <grant|transfer-domain> [options] [--execute]'
  )
}

function config(options: CliOptions, environment: Environment): OperatorConfig {
  return {
    accountId: required(environment.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'),
    apiToken: required(environment.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN'),
    databaseId: required(
      options.databaseId ?? environment.CLOUDFLARE_DATABASE_ID,
      'CLOUDFLARE_DATABASE_ID or --database'
    )
  }
}

function queryD1(
  operatorConfig: OperatorConfig,
  queries: ReadonlyArray<Query>,
  fetchImpl: FetchImplementation
) {
  return Effect.tryPromise({
    try: (signal) =>
      fetchImpl(
        `${API_ROOT}/accounts/${encodeURIComponent(operatorConfig.accountId)}/d1/database/${encodeURIComponent(operatorConfig.databaseId)}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${operatorConfig.apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ batch: queries }),
          signal
        }
      ).then((response) =>
        response.text().then((text) => ({ status: response.status, text }))
      ),
    catch: () => new Error('Cloudflare API request failed')
  }).pipe(
    Effect.flatMap(({ status, text }) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return Effect.fail(new Error(`Cloudflare API returned HTTP ${status}`))
      }
      return decodeEnvelope(parsed).pipe(
        Effect.flatMap((envelope) => {
          if (!envelope.success || status < 200 || status >= 300) {
            return Effect.fail(
              new Error(
                envelope.errors?.[0]?.message ?? `Cloudflare API HTTP ${status}`
              )
            )
          }
          return Effect.succeed(envelope.result ?? [])
        })
      )
    })
  )
}

function grant(
  options: GrantOptions,
  operatorConfig: OperatorConfig,
  fetchImpl: FetchImplementation
) {
  return Effect.gen(function* () {
    const [inspection] = yield* queryD1(
      operatorConfig,
      [
        {
          sql: `SELECT wm.workspaceId AS workspace_id, w.slug AS workspace_slug,
                       wm.userId AS user_id
                FROM workspace_members wm
                JOIN workspaces w ON w.id = wm.workspaceId
                WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.role = 'owner'
                LIMIT 1`,
          params: [options.workspaceId, options.ownerUserId]
        }
      ],
      fetchImpl
    )
    const owner = Option.getOrUndefined(decodeWorkspaceOwner(inspection?.results?.[0]))
    if (owner === undefined) {
      return yield* Effect.fail(
        new Error('The requested user is not a workspace owner')
      )
    }
    const nowDateTime = yield* DateTime.now
    const createdAt = DateTime.formatIso(nowDateTime)
    const expiresAt = DateTime.formatIso(DateTime.add(nowDateTime, { hours: 1 }))
    const exceptionId = `sso-recovery-${randomUUID()}`
    const auditId = `aud-${randomUUID()}`
    const result = {
      dryRun: !options.execute,
      exceptionId,
      workspaceId: options.workspaceId,
      ownerUserId: options.ownerUserId,
      expiresAt,
      repairPath: `/account?repair=sso&workspace=${encodeURIComponent(owner.workspace_slug)}&exception=${encodeURIComponent(exceptionId)}`
    }
    if (!options.execute) {
      return result
    }
    const metadata = JSON.stringify({
      ownerUserId: options.ownerUserId,
      grantedBy: options.operatorId,
      reason: options.reason,
      expiresAt
    })
    const responses = yield* queryD1(
      operatorConfig,
      [
        {
          sql: `INSERT INTO workspace_sso_recovery_exceptions
                  (id, workspace_id, user_id, reason, granted_by, session_id,
                   created_notified_at, used_notified_at, expired_notified_at,
                   created_at, expires_at, expired_at, used_at)
                SELECT ?, wm.workspaceId, wm.userId, ?, ?, NULL, NULL, NULL, NULL,
                       ?, ?, NULL, NULL
                FROM workspace_members wm
                WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.role = 'owner'`,
          params: [
            exceptionId,
            options.reason,
            options.operatorId,
            createdAt,
            expiresAt,
            options.workspaceId,
            options.ownerUserId
          ]
        },
        {
          sql: `INSERT INTO audit_events
                  (id, workspace_id, actor_user_id, actor_type, event_type,
                   target_type, target_id, metadata, created_at)
                SELECT ?, workspace_id, NULL, 'system',
                       'workspace_sso.recovery_exception_created',
                       'workspace_sso_recovery_exception', id, ?, ?
                FROM workspace_sso_recovery_exceptions WHERE id = ?`,
          params: [auditId, metadata, createdAt, exceptionId]
        },
        {
          sql: `SELECT id FROM workspace_sso_recovery_exceptions
                WHERE id = ? AND workspace_id = ? AND user_id = ?`,
          params: [exceptionId, options.workspaceId, options.ownerUserId]
        }
      ],
      fetchImpl
    )
    if ((responses[2]?.results?.length ?? 0) !== 1) {
      return yield* Effect.fail(
        new Error('Recovery grant did not commit; confirm the owner and retry')
      )
    }
    return { ...result, dryRun: false }
  })
}

function transferDomain(
  options: TransferOptions,
  operatorConfig: OperatorConfig,
  fetchImpl: FetchImplementation
) {
  return Effect.gen(function* () {
    const [inspection] = yield* queryD1(
      operatorConfig,
      [
        {
          sql: `SELECT claim.id
                FROM workspace_sso_domain_claims claim
                JOIN workspaces target ON target.id = ?
                WHERE claim.domain = ? AND claim.workspace_id = ?
                LIMIT 1`,
          params: [
            options.targetWorkspaceId,
            options.domain,
            options.expectedWorkspaceId
          ]
        }
      ],
      fetchImpl
    )
    const claim = inspection?.results?.[0]
    const claimId = Option.getOrUndefined(decodeClaimId(claim?.id))
    if (claimId === undefined) {
      return yield* Effect.fail(
        new Error('Domain claim or target workspace did not match')
      )
    }
    const result = {
      dryRun: !options.execute,
      domain: options.domain,
      claimId,
      fromWorkspaceId: options.expectedWorkspaceId,
      toWorkspaceId: options.targetWorkspaceId
    }
    if (!options.execute) {
      return result
    }
    const now = DateTime.formatIso(yield* DateTime.now)
    const auditId = `aud-${randomUUID()}`
    const metadata = JSON.stringify({
      domain: options.domain,
      targetWorkspaceId: options.targetWorkspaceId,
      operatorId: options.operatorId,
      reason: options.reason
    })
    const responses = yield* queryD1(
      operatorConfig,
      [
        {
          sql: `UPDATE workspace_sso_domain_claims
                SET workspace_id = ?, status = 'pending', verification_token_hash = '',
                    verified_at = NULL, last_checked_at = NULL, grace_until = NULL,
                    updated_at = ?
                WHERE id = ? AND workspace_id = ? AND domain = ?`,
          params: [
            options.targetWorkspaceId,
            now,
            claimId,
            options.expectedWorkspaceId,
            options.domain
          ]
        },
        {
          sql: `INSERT INTO audit_events
                  (id, workspace_id, actor_user_id, actor_type, event_type,
                   target_type, target_id, metadata, created_at)
                SELECT ?, ?, NULL, 'system', 'workspace_sso.domain_transferred',
                       'workspace_sso_domain_claim', id, ?, ?
                FROM workspace_sso_domain_claims
                WHERE id = ? AND workspace_id = ? AND status = 'pending'
                  AND verification_token_hash = '' AND updated_at = ?`,
          params: [
            auditId,
            options.expectedWorkspaceId,
            metadata,
            now,
            claimId,
            options.targetWorkspaceId,
            now
          ]
        },
        {
          sql: `SELECT id FROM workspace_sso_domain_claims
                WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
          params: [claimId, options.targetWorkspaceId]
        }
      ],
      fetchImpl
    )
    if ((responses[2]?.results?.length ?? 0) !== 1) {
      return yield* Effect.fail(
        new Error('Domain transfer did not commit; inspect the claim and retry')
      )
    }
    return { ...result, dryRun: false }
  })
}

function main(
  rawArgs: ReadonlyArray<string>,
  environment: Environment,
  fetchImpl: FetchImplementation,
  write: (text: string) => void
) {
  return Effect.gen(function* () {
    const options = parseCli(rawArgs)
    const operatorConfig = config(options, environment)
    let result: unknown
    if (options.command === 'grant') {
      result = yield* grant(options, operatorConfig, fetchImpl)
    } else {
      result = yield* transferDomain(options, operatorConfig, fetchImpl)
    }
    write(`${JSON.stringify(result, null, 2)}\n`)
  })
}

export function runSsoRecoveryOperator(
  rawArgs: ReadonlyArray<string>,
  environment: Environment,
  fetchImpl: FetchImplementation,
  write: (text: string) => void
): Promise<void> {
  return Effect.runPromise(main(rawArgs, environment, fetchImpl, write))
}

if (
  process.argv[1] !== undefined &&
  process.argv[1] === new URL(import.meta.url).pathname
) {
  runSsoRecoveryOperator(process.argv.slice(2), process.env, globalThis.fetch, (text) =>
    process.stdout.write(text)
  ).catch((error: unknown) => {
    const message = Option.getOrElse(decodeErrorOption(error), () => ({
      message: 'SSO recovery command failed'
    })).message
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
