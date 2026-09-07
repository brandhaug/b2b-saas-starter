// Node operator CLI: Promise-native fetch/process boundary; no application runtime.
// oxlint-disable effect/noNewPromise
import { Schema } from 'effect'
import { runWithSentryCronMonitor } from './d1-backup.ts'

const QueueTarget = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  deadLetter: Schema.Boolean
})
const QueueMetrics = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({
    backlog_count: Schema.Number,
    oldest_message_timestamp_ms: Schema.Number
  })
})
const decodeTargets = Schema.decodeUnknownSync(Schema.Array(QueueTarget))
const decodeMetrics = Schema.decodeUnknownSync(QueueMetrics)

type Environment = Readonly<Record<string, string | undefined>>
type QueueObservation = {
  readonly queue: string
  readonly queueId: string
  readonly backlog: number
  readonly oldestAgeMs: number | null
  readonly healthy: boolean
}

function required(environment: Environment, name: string): string {
  const value = environment[name]
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

/** Unknown age on a nonempty queue is not evidence that the queue is healthy. */
export function queueIsHealthy(
  count: number,
  oldest: number,
  deadLetter: boolean,
  now: number
): boolean {
  if (!Number.isSafeInteger(count) || count < 0) {
    return false
  }
  if (count === 0) {
    return true
  }
  return !deadLetter && oldest > 0 && oldest <= now && now - oldest < 900_000
}

/** Read-only Cloudflare checks keep working when the application's consumers stop. */
export async function inspectQueues(
  environment: Environment,
  request: typeof fetch = fetch,
  now: number = Date.now()
): Promise<ReadonlyArray<QueueObservation>> {
  const account = required(environment, 'CLOUDFLARE_ACCOUNT_ID')
  const token = required(environment, 'CLOUDFLARE_API_TOKEN')
  const targets = decodeTargets(JSON.parse(required(environment, 'OPS_QUEUES')))
  if (!/^[a-f0-9]{32}$/i.test(account) || targets.length === 0 || targets.length > 30) {
    throw new Error('Expected an account ID and one through thirty queue targets')
  }
  if (targets.some((target) => !/^[a-f0-9]{32}$/i.test(target.id))) {
    throw new Error('Each queue target must have a Cloudflare queue ID')
  }
  return Promise.all(
    targets.map(async (target) => {
      const response = await request(
        `https://api.cloudflare.com/client/v4/accounts/${account}/queues/${target.id}/metrics`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000)
        }
      )
      if (!response.ok) {
        throw new Error(`Queue metrics request failed with HTTP ${response.status}`)
      }
      const metrics = decodeMetrics(await response.json())
      if (!metrics.success) {
        throw new Error('Cloudflare rejected queue metrics request')
      }
      const count = metrics.result.backlog_count
      const oldest = metrics.result.oldest_message_timestamp_ms
      let oldestAgeMs: number | null = null
      if (oldest > 0 && oldest <= now) {
        oldestAgeMs = now - oldest
      }
      return {
        queue: target.name,
        queueId: target.id,
        backlog: count,
        oldestAgeMs,
        healthy: queueIsHealthy(count, oldest, target.deadLetter, now)
      }
    })
  )
}

if (import.meta.main) {
  try {
    await runWithSentryCronMonitor('SENTRY_QUEUE_MONITOR_SLUG', async () => {
      const observations = await inspectQueues(process.env)
      console.log(
        JSON.stringify({ observedAt: new Date().toISOString(), queues: observations })
      )
      if (observations.some((queue) => !queue.healthy)) {
        throw new Error('Queue backlog requires operator recovery')
      }
    })
  } catch {
    console.error('Queue monitoring failed; inspect the run and Sentry check-in')
    process.exitCode = 1
  }
}
