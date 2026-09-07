import { parseArgs } from 'node:util'

import { Effect, Option, Schema } from 'effect'

type FetchImplementation = typeof globalThis.fetch
type Environment = Readonly<Record<string, string | undefined>>

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const INSPECTION_LIMIT = 25

const CloudflareError = Schema.Struct({ message: Schema.String })
const CloudflareEnvelope = Schema.Struct({
  success: Schema.Boolean,
  errors: Schema.optionalKey(Schema.Array(CloudflareError)),
  result: Schema.optionalKey(Schema.Unknown)
})
const D1QueryResult = Schema.Struct({
  results: Schema.optionalKey(
    Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
  )
})
const decodeCloudflareEnvelope = Schema.decodeUnknownEffect(CloudflareEnvelope)
const decodeD1QueryResults = Schema.decodeUnknownEffect(Schema.Array(D1QueryResult))
const decodeStringOption = Schema.decodeUnknownOption(Schema.String)
const decodeErrorOption = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.String })
)

type OperatorConfig = {
  readonly accountId?: string | undefined
  readonly apiToken?: string | undefined
  readonly databaseId?: string | undefined
  readonly billingQueueId?: string | undefined
}

type CliOptions = {
  readonly command: 'inspect' | 'retry'
  readonly workspaceId: string
  readonly operatorId?: string | undefined
  readonly execute: boolean
  readonly databaseId?: string | undefined
  readonly billingQueueId?: string | undefined
  readonly limit: number
  readonly customerId?: string | undefined
  readonly checkoutSessionId?: string | undefined
}

type OperatorRetryMessage = {
  readonly kind: 'billing.seat_sync'
  readonly workspaceId: string
  readonly reason: 'operator_retry'
  readonly operatorId: string
  recovery?: {
    readonly customerId?: string | undefined
    readonly checkoutSessionId?: string | undefined
  }
}

function envValue(name: string, environment: Environment): string | undefined {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) {
    return undefined
  }
  return value
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function optionString(value: string | boolean | undefined): string | undefined {
  return Option.getOrUndefined(decodeStringOption(value))
}

function optionBoolean(value: string | boolean | undefined): boolean {
  return value === true
}

function optionNumber(value: string | boolean | undefined): number {
  const text = optionString(value)
  if (text === undefined) {
    return INSPECTION_LIMIT
  }
  const parsed = Number(text)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('--limit must be an integer from 1 through 100')
  }
  return parsed
}

function parseCli(rawArgs: ReadonlyArray<string>): CliOptions {
  const separator = rawArgs.indexOf('--')
  const args = separator === -1 ? rawArgs : rawArgs.slice(separator + 1)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      operator: { type: 'string' },
      execute: { type: 'boolean' },
      database: { type: 'string' },
      queue: { type: 'string' },
      limit: { type: 'string' },
      customer: { type: 'string' },
      'checkout-session': { type: 'string' }
    }
  })
  const command = parsed.positionals[0]
  if (command !== 'inspect' && command !== 'retry') {
    throw new Error('Usage: billing-operator.ts <inspect|retry> --workspace <id>')
  }
  const operatorId = optionString(parsed.values.operator)
  if (command === 'retry' && operatorId === undefined) {
    throw new Error('The retry command requires --operator <operator-id>')
  }
  return {
    command,
    workspaceId: required(optionString(parsed.values.workspace), '--workspace <id>'),
    operatorId,
    execute: optionBoolean(parsed.values.execute),
    databaseId: optionString(parsed.values.database),
    billingQueueId: optionString(parsed.values.queue),
    limit: optionNumber(parsed.values.limit),
    customerId: optionString(parsed.values.customer),
    checkoutSessionId: optionString(parsed.values['checkout-session'])
  }
}

function config(options: CliOptions, environment: Environment): OperatorConfig {
  const billingQueueId =
    options.billingQueueId ?? envValue('CLOUDFLARE_BILLING_QUEUE_ID', environment)
  if (options.command === 'retry' && billingQueueId === undefined) {
    throw new Error('Missing CLOUDFLARE_BILLING_QUEUE_ID or --queue')
  }
  const result: OperatorConfig = {
    accountId: envValue('CLOUDFLARE_ACCOUNT_ID', environment),
    apiToken: envValue('CLOUDFLARE_API_TOKEN', environment),
    databaseId: options.databaseId ?? envValue('CLOUDFLARE_DATABASE_ID', environment),
    billingQueueId
  }
  if (options.command === 'inspect') {
    required(result.accountId, 'CLOUDFLARE_ACCOUNT_ID')
    required(result.apiToken, 'CLOUDFLARE_API_TOKEN')
    required(result.databaseId, 'CLOUDFLARE_DATABASE_ID or --database')
  }
  if (options.command === 'retry' && options.execute) {
    required(result.accountId, 'CLOUDFLARE_ACCOUNT_ID')
    required(result.apiToken, 'CLOUDFLARE_API_TOKEN')
  }
  return result
}

function cloudflareRequest(input: {
  readonly config: OperatorConfig
  readonly path: string
  readonly method: 'POST'
  readonly body: unknown
  readonly fetchImpl: FetchImplementation
}) {
  const apiToken = required(input.config.apiToken, 'CLOUDFLARE_API_TOKEN')
  return Effect.tryPromise({
    try: (signal) =>
      input
        .fetchImpl(`${API_ROOT}${input.path}`, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(input.body),
          signal
        })
        .then((response) =>
          response.text().then((text) => ({ status: response.status, text }))
        ),
    catch: () => new Error('Cloudflare API request failed')
  }).pipe(
    Effect.flatMap(({ status, text }) => {
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return Effect.fail(new Error(`Cloudflare API returned HTTP ${status}`))
      }
      return decodeCloudflareEnvelope(json).pipe(
        Effect.flatMap((envelope) => {
          if (!envelope.success || status < 200 || status >= 300) {
            const message = envelope.errors?.[0]?.message ?? `HTTP ${status}`
            return Effect.fail(new Error(`Cloudflare API: ${message}`))
          }
          return Effect.succeed(envelope.result)
        })
      )
    })
  )
}

function queryD1(
  operatorConfig: OperatorConfig,
  sql: string,
  params: ReadonlyArray<string>,
  fetchImpl: FetchImplementation
) {
  const accountId = required(operatorConfig.accountId, 'CLOUDFLARE_ACCOUNT_ID')
  const databaseId = required(
    operatorConfig.databaseId,
    'CLOUDFLARE_DATABASE_ID or --database'
  )
  return cloudflareRequest({
    config: operatorConfig,
    method: 'POST',
    path: `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    body: { sql, params },
    fetchImpl
  }).pipe(
    Effect.flatMap((result) =>
      decodeD1QueryResults(result).pipe(
        Effect.map((queries) => queries[0]?.results ?? [])
      )
    )
  )
}

function inspect(
  options: CliOptions,
  operatorConfig: OperatorConfig,
  fetchImpl: FetchImplementation
) {
  const workspace = options.workspaceId
  return Effect.gen(function* () {
    const synchronization = yield* queryD1(
      operatorConfig,
      `SELECT workspace_id, status, desired_seat_quantity, observed_seat_quantity,
       last_synced_at, last_attempt_at, unresolved_since, failure_reason,
       failure_count, next_attempt_at, conflict_reason, lease_fence,
       lease_expires_at, updated_at
       FROM billing_synchronization WHERE workspace_id = ?`,
      [workspace],
      fetchImpl
    )
    const subscriptions = yield* queryD1(
      operatorConfig,
      `SELECT workspace_id, stripe_customer_id, stripe_subscription_id,
       stripe_subscription_item_id, seat_quantity, updated_at
       FROM workspace_subscriptions WHERE workspace_id = ?`,
      [workspace],
      fetchImpl
    )
    const providerEvents = yield* queryD1(
      operatorConfig,
      `SELECT provider_event_id, event_type, provider_created_at, status,
       outcome, failure_reason, attempt_count, received_at, completed_at,
       resolved_at, updated_at FROM billing_provider_events
       WHERE workspace_id = ? ORDER BY received_at DESC LIMIT ?`,
      [workspace, String(options.limit)],
      fetchImpl
    )
    const checkoutClaims = yield* queryD1(
      operatorConfig,
      `SELECT workspace_id, plan_id, idempotency_key, price_id, quantity,
       status, stripe_session_id, attempt_count, failure_reason, expires_at,
       created_at, updated_at FROM billing_checkout_claims
       WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?`,
      [workspace, String(options.limit)],
      fetchImpl
    )
    return {
      workspaceId: workspace,
      synchronization,
      subscriptions,
      providerEvents,
      checkoutClaims
    }
  })
}

function retry(
  options: CliOptions,
  operatorConfig: OperatorConfig,
  fetchImpl: FetchImplementation
) {
  const operatorId = required(options.operatorId, '--operator <operator-id>')
  const queueId = required(
    operatorConfig.billingQueueId,
    'CLOUDFLARE_BILLING_QUEUE_ID or --queue'
  )
  const message: OperatorRetryMessage = {
    kind: 'billing.seat_sync',
    workspaceId: options.workspaceId,
    reason: 'operator_retry',
    operatorId
  }
  if (options.customerId !== undefined || options.checkoutSessionId !== undefined) {
    const recovery: NonNullable<OperatorRetryMessage['recovery']> = {}
    if (options.customerId !== undefined) {
      recovery.customerId = options.customerId
    }
    if (options.checkoutSessionId !== undefined) {
      recovery.checkoutSessionId = options.checkoutSessionId
    }
    message.recovery = recovery
  }
  if (!options.execute) {
    return Effect.succeed({
      dryRun: true,
      queue: queueId,
      message
    })
  }
  const accountId = required(operatorConfig.accountId, 'CLOUDFLARE_ACCOUNT_ID')
  return cloudflareRequest({
    config: operatorConfig,
    method: 'POST',
    path: `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/messages`,
    body: { body: message, content_type: 'json' },
    fetchImpl
  }).pipe(Effect.as({ dryRun: false, queue: queueId, message }))
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
    if (options.command === 'inspect') {
      const result = yield* inspect(options, operatorConfig, fetchImpl)
      write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }
    const result = yield* retry(options, operatorConfig, fetchImpl)
    write(`${JSON.stringify(result, null, 2)}\n`)
  })
}

export function runOperator(
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
  runOperator(process.argv.slice(2), process.env, globalThis.fetch, (text) =>
    process.stdout.write(text)
  ).catch((error: unknown) => {
    const message = Option.getOrElse(decodeErrorOption(error), () => ({
      message: 'operator command failed'
    })).message
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
