// Node operator CLI: Promise-native fetch/process boundary; no application runtime.
// oxlint-disable effect/noNewPromise
import { Effect, Schema } from 'effect'
import { getMetricsQueue } from '@distilled.cloud/cloudflare/queues'
import { requiredEnv } from './lib/env.ts'
import { withCloudflareToken } from './lib/cloudflare.ts'

const QueueTarget = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  deadLetter: Schema.Boolean
})
const decodeTargets = Schema.decodeUnknownSync(Schema.Array(QueueTarget))
const decodeMetrics = Schema.decodeUnknownSync(
  Schema.Struct({
    backlogCount: Schema.Number,
    oldestMessageTimestampMs: Schema.Number
  })
)

type Environment = Readonly<Record<string, string | undefined>>
type QueueObservation = {
  readonly queue: string
  readonly queueId: string
  readonly backlog: number
  readonly oldestAgeMs: number | null
  readonly healthy: boolean
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
  const account = requiredEnv('CLOUDFLARE_ACCOUNT_ID', environment)
  const token = requiredEnv('CLOUDFLARE_API_TOKEN', environment)
  const targets = decodeTargets(JSON.parse(requiredEnv('OPS_QUEUES', environment)))
  if (!/^[a-f0-9]{32}$/i.test(account) || targets.length === 0 || targets.length > 30) {
    throw new Error('Expected an account ID and one through thirty queue targets')
  }
  if (targets.some((target) => !/^[a-f0-9]{32}$/i.test(target.id))) {
    throw new Error('Each queue target must have a Cloudflare queue ID')
  }
  return Promise.all(
    targets.map(async (target) => {
      const metrics = decodeMetrics(
        await Effect.runPromise(
          withCloudflareToken(
            getMetricsQueue({ accountId: account, queueId: target.id }),
            token,
            request
          ).pipe(Effect.timeout('10 seconds'))
        )
      )
      const count = metrics.backlogCount
      const oldest = metrics.oldestMessageTimestampMs
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
    const observations = await inspectQueues(process.env)
    console.log(
      JSON.stringify({ observedAt: new Date().toISOString(), queues: observations })
    )
    if (observations.some((queue) => !queue.healthy)) {
      throw new Error('Queue backlog requires operator recovery')
    }
  } catch {
    console.error('Queue monitoring failed; inspect the workflow run')
    process.exitCode = 1
  }
}
